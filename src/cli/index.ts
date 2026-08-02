#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { ingestProject, IngestError } from "../ingest/index.js";
import { renderToPdf } from "../render/index.js";

class NotImplementedError extends Error {}
class ProjectNotFoundError extends Error {}

const PROJECTS_ROOT = path.resolve(process.cwd(), "workspace/projects");

function projectRootFor(slug: string): string {
  return path.join(PROJECTS_ROOT, slug);
}

async function assertProjectExists(slug: string): Promise<string> {
  const root = projectRootFor(slug);
  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ProjectNotFoundError(
      `Project "${slug}" not found at ${root}. Create workspace/projects/${slug}/source/original.pdf first.`,
    );
  }
  return root;
}

// --- state/build-state.json persistence (R8: exit codes are proof, not prose) ----

interface StageResult {
  status: "success" | "failed" | "not_implemented";
  exitCode: number;
  message: string;
  startedAt: string;
  finishedAt: string;
  details?: unknown;
}

interface BuildState {
  project: string;
  updatedAt: string;
  stages: Record<string, StageResult>;
}

async function readBuildState(projectRoot: string): Promise<BuildState | undefined> {
  try {
    const raw = await readFile(path.join(projectRoot, "state", "build-state.json"), "utf-8");
    return JSON.parse(raw) as BuildState;
  } catch {
    return undefined;
  }
}

async function persistStageResult(
  projectRoot: string,
  slug: string,
  stage: string,
  result: StageResult,
): Promise<void> {
  const stateDir = path.join(projectRoot, "state");
  await mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, "build-state.json");
  const existing = (await readBuildState(projectRoot)) ?? { project: slug, updatedAt: "", stages: {} };
  existing.project = slug;
  existing.stages[stage] = result;
  existing.updatedAt = new Date().toISOString();
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
}

/**
 * Runs one pipeline stage, always persisting a truthful StageResult to
 * state/build-state.json before returning — success, failure, and
 * not-implemented are all real, provable outcomes, never fabricated (R8).
 */
async function runStage(
  slug: string,
  stage: string,
  fn: (projectRoot: string) => Promise<{ message: string; details?: unknown }>,
): Promise<number> {
  const startedAt = new Date().toISOString();
  let projectRoot: string;
  try {
    projectRoot = await assertProjectExists(slug);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  try {
    const { message, details } = await fn(projectRoot);
    const finishedAt = new Date().toISOString();
    await persistStageResult(projectRoot, slug, stage, {
      status: "success",
      exitCode: 0,
      message,
      startedAt,
      finishedAt,
      details,
    });
    console.log(message);
    return 0;
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const notImplemented = err instanceof NotImplementedError;
    const status = notImplemented ? "not_implemented" : "failed";
    const exitCode = notImplemented ? 2 : 1;
    await persistStageResult(projectRoot, slug, stage, {
      status,
      exitCode,
      message: (err as Error).message,
      startedAt,
      finishedAt,
    });
    console.error((err as Error).message);
    return exitCode;
  }
}

function notImplementedStage(stage: string): () => Promise<{ message: string; details?: unknown }> {
  return async () => {
    throw new NotImplementedError(
      `studio:${stage} is not implemented yet (see docs/implementation-plan.md for build order).`,
    );
  };
}

// --- CLI wiring --------------------------------------------------------------

const program = new Command();
program.name("studio").description("Ebook Studio pipeline CLI").exitOverride();

program
  .command("ingest")
  .requiredOption("--project <slug>", "project slug under workspace/projects/")
  .action(async (opts: { project: string }) => {
    process.exitCode = await runStage(opts.project, "ingest", async () => {
      const result = await ingestProject({ projectSlug: opts.project });
      const { chapters, bonuses, warnings, fallbackUsed } = result.inventory;
      const summary = `Ingested ${chapters.length} chapter(s) and ${bonuses.length} bonus(es)${
        fallbackUsed ? " (fallback: no markers detected)" : ""
      }${warnings.length ? ` — ${warnings.length} warning(s)` : ""}. Wrote ${result.inventoryPath}`;
      return { message: summary, details: result.inventory };
    });
  });

program
  .command("prototype")
  .description("Render an HTML fragment through Paged.js + Playwright to a preview PDF (and PNGs).")
  .requiredOption("--project <slug>", "project slug under workspace/projects/")
  .requiredOption("--html <path>", "path to an HTML fragment file, relative to the project root")
  .option("--css <path...>", "path(s) to CSS file(s) to inline, relative to the project root")
  .option("--out <path>", "output PDF path, relative to the project root", "output/prototype.pdf")
  .option("--previews", "also export one PNG per page to previews/", false)
  .option("--title <text>", "document title", "Ebook Studio prototype")
  .action(async (opts: { project: string; html: string; css?: string[]; out: string; previews: boolean; title: string }) => {
    process.exitCode = await runStage(opts.project, "prototype", async (projectRoot) => {
      const bodyHtml = await readFile(path.join(projectRoot, opts.html), "utf-8");
      const css = await Promise.all(
        (opts.css ?? []).map((cssPath) => readFile(path.join(projectRoot, cssPath), "utf-8")),
      );
      const outputPdfPath = path.join(projectRoot, opts.out);
      const previewsDir = opts.previews ? path.join(projectRoot, "previews") : undefined;
      const result = await renderToPdf({ bodyHtml, css, outputPdfPath, previewsDir, title: opts.title });
      const summary = `Rendered ${result.pageCount} page(s) to ${result.pdfPath}${
        result.previewPaths.length ? ` and ${result.previewPaths.length} preview PNG(s)` : ""
      }.`;
      return { message: summary, details: result };
    });
  });

for (const stage of ["audit", "plan", "design", "build", "qc"] as const) {
  program
    .command(stage)
    .requiredOption("--project <slug>", "project slug under workspace/projects/")
    .action(async (opts: { project: string }) => {
      process.exitCode = await runStage(opts.project, stage, notImplementedStage(stage));
    });
}

program
  .command("all")
  .description("Run every pipeline stage in order, stopping at the first failure.")
  .requiredOption("--project <slug>", "project slug under workspace/projects/")
  .action(async (opts: { project: string }) => {
    const stages: Array<[string, (projectRoot: string) => Promise<{ message: string; details?: unknown }>]> = [
      ["ingest", async () => {
        const result = await ingestProject({ projectSlug: opts.project });
        return { message: `Ingested ${result.inventory.chapters.length} chapter(s).`, details: result.inventory };
      }],
      ["audit", notImplementedStage("audit")],
      ["plan", notImplementedStage("plan")],
      ["design", notImplementedStage("design")],
      ["build", notImplementedStage("build")],
      ["qc", notImplementedStage("qc")],
    ];

    for (const [stage, fn] of stages) {
      const exitCode = await runStage(opts.project, stage, fn);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
        return;
      }
    }
    process.exitCode = 0;
  });

program
  .command("status")
  .description("Print the recorded state of every stage run so far for a project.")
  .requiredOption("--project <slug>", "project slug under workspace/projects/")
  .action(async (opts: { project: string }) => {
    try {
      const projectRoot = await assertProjectExists(opts.project);
      const state = await readBuildState(projectRoot);
      if (!state) {
        console.log(`No build state yet for "${opts.project}". Run studio:ingest first.`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(state, null, 2));
      process.exitCode = 0;
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof IngestError || err instanceof ProjectNotFoundError) {
    console.error(err.message);
    process.exitCode = 1;
  } else if ((err as { code?: string }).code?.startsWith("commander.")) {
    // commander already printed a usage/help message; exit code was set via exitOverride
    process.exitCode = (err as { exitCode?: number }).exitCode ?? 1;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
}
