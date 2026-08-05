import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { Ajv } from "ajv";
import { parse as parseYaml } from "yaml";
import qcReportSchema from "../../schemas/qc-report.schema.json" with { type: "json" };
import type { Inventory } from "../ingest/index.js";
import type { ProjectConfig } from "../design/index.js";
import type { QcCheckResult, QcContext, QcReport } from "./types.js";
import { computeAestheticScore } from "./aesthetic.js";
import { extractPageText } from "./pdf-text.js";

import { checkFontsEmbedded } from "./checks/fonts-embedded.js";
import { checkTextCoverage } from "./checks/text-coverage.js";
import { checkNoBrokenChars } from "./checks/no-broken-chars.js";
import { checkInkCoverage } from "./checks/ink-coverage.js";
import { checkNoOverflow } from "./checks/no-overflow.js";
import { checkMinFontSize } from "./checks/min-font-size.js";
import { checkContrast } from "./checks/contrast.js";
import { checkAssetsExist } from "./checks/assets-exist.js";
import { checkImageDpi } from "./checks/image-dpi.js";
import { checkOutlineToc } from "./checks/outline-toc.js";
import { checkMetadata } from "./checks/metadata.js";
import { checkFileSize } from "./checks/file-size.js";
import { checkNoBonusInBody } from "./checks/no-bonus-in-body.js";
import { checkStructure } from "./checks/structure.js";

export class QcError extends Error {}

export interface QcOptions {
  projectSlug: string;
  /** Defaults to workspace/projects relative to the repo root. */
  projectsRoot?: string;
  /** Defaults to process.cwd(); the repo root holding templates/. */
  repoRoot?: string;
}

export interface QcResult {
  report: QcReport;
  reportJsonPath: string;
  reportMdPath: string;
}

const CHECKS = [
  checkFontsEmbedded,
  checkTextCoverage,
  checkNoBrokenChars,
  checkInkCoverage,
  checkNoOverflow,
  checkMinFontSize,
  checkContrast,
  checkAssetsExist,
  checkImageDpi,
  checkOutlineToc,
  checkMetadata,
  checkFileSize,
  checkNoBonusInBody,
  checkStructure,
];

const PREFERRED_PDF_NAMES = ["ebook-final.pdf", "prototype.pdf"];

async function findOutputPdf(projectRoot: string, slug: string): Promise<string> {
  const outputDir = path.join(projectRoot, "output");
  let entries: string[];
  try {
    entries = (await readdir(outputDir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    throw new QcError(`No output/ directory found at ${outputDir}. Run studio:prototype or studio:build first.`);
  }
  if (entries.length === 0) {
    throw new QcError(`No PDF found in ${outputDir}. Run studio:prototype or studio:build first.`);
  }
  const preferred = [`${slug}-book.pdf`, ...PREFERRED_PDF_NAMES].find((name) => entries.includes(name));
  const chosen = preferred ?? entries.sort()[0];
  return path.join(outputDir, chosen);
}

async function findBookHtml(projectRoot: string, slug: string): Promise<{ html: string; htmlPath: string } | null> {
  const htmlDir = path.join(projectRoot, "html");
  let entries: string[];
  try {
    entries = (await readdir(htmlDir)).filter((f) => f.toLowerCase().endsWith(".html"));
  } catch {
    return null;
  }
  if (entries.length === 0) return null;
  const preferred = [`${slug}-book.html`].find((name) => entries.includes(name));
  const chosen = preferred ?? (entries.length === 1 ? entries[0] : undefined);
  if (!chosen) return null;
  const htmlPath = path.join(htmlDir, chosen);
  return { html: await readFile(htmlPath, "utf-8"), htmlPath };
}

/**
 * Collects preview PNGs from `previews/`, including the per-chapter
 * subdirectories `studio:prototype` now writes into.
 *
 * Previews used to land in one flat folder with every chapter reusing
 * `page-001.png`, so each render silently destroyed the last one — and this
 * function, feeding the ink-coverage gate, therefore scored whichever chapter
 * happened to render most recently while reporting as if it had covered the
 * book. Reading the subdirectories in sorted order restores a whole-book view.
 */
async function listPreviews(previewsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(previewsDir, { withFileTypes: true });

    const chapterDirs = entries
      .filter((e) => e.isDirectory() && /^chapter-/i.test(e.name))
      .map((e) => e.name)
      .sort();
    if (chapterDirs.length > 0) {
      const collected: string[] = [];
      for (const dir of chapterDirs) {
        const full = path.join(previewsDir, dir);
        const pages = (await readdir(full)).filter((f) => /^page-\d+\.png$/i.test(f)).sort();
        collected.push(...pages.map((f) => path.join(full, f)));
      }
      return collected;
    }

    const flat = entries.filter((e) => e.isFile() && /^page-\d+\.png$/i.test(e.name)).map((e) => e.name);
    return flat.sort().map((f) => path.join(previewsDir, f));
  } catch {
    return [];
  }
}

function resolveProjectRoot(options: QcOptions): { projectRoot: string; repoRoot: string } {
  const repoRoot = options.repoRoot ?? process.cwd();
  const projectsRoot = options.projectsRoot ?? path.resolve(repoRoot, "workspace/projects");
  return { projectRoot: path.join(projectsRoot, options.projectSlug), repoRoot };
}

function renderReportMarkdown(report: QcReport): string {
  const lines: string[] = [
    `# QC report — ${report.project}`,
    "",
    `Generated ${report.generatedAt}. Output: \`${report.outputPdfPath}\` (${report.pageCount} page(s)).`,
    "",
    `## Result: ${report.overallPass ? "✅ GO" : "❌ NO-GO"}`,
    "",
    "| Gate | Status | Evidence |",
    "|---|---|---|",
  ];
  for (const check of report.checks) {
    const badge = check.status === "pass" ? "✅ pass" : check.status === "fail" ? "❌ fail" : "⏭️ skipped";
    lines.push(`| ${check.id} | ${badge} | ${check.evidence.replace(/\|/g, "\\|")} |`);
  }

  lines.push(
    "",
    `## Aesthetic score (non-blocking): ${report.aesthetic.total}/${report.aesthetic.max}`,
    "",
    "| Dimension | Score |",
    "|---|---|",
    `| Content | ${report.aesthetic.breakdown.content}/25 |`,
    `| Typography | ${report.aesthetic.breakdown.typography}/20 |`,
    `| Layout | ${report.aesthetic.breakdown.layout}/20 |`,
    `| Consistency | ${report.aesthetic.breakdown.consistency}/15 |`,
    `| Technical | ${report.aesthetic.breakdown.technical}/10 |`,
    `| Niche fit | ${report.aesthetic.breakdown.nicheFit}/10 |`,
    "",
  );
  if (report.aesthetic.notes.length > 0) {
    lines.push("**Notes:**");
    for (const note of report.aesthetic.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateQcReport = ajv.compile(qcReportSchema);

export async function runQc(options: QcOptions): Promise<QcResult> {
  const { projectRoot, repoRoot } = resolveProjectRoot(options);

  let inventory: Inventory;
  try {
    inventory = JSON.parse(await readFile(path.join(projectRoot, "inventory.json"), "utf-8")) as Inventory;
  } catch {
    throw new QcError(`No inventory.json found for "${options.projectSlug}". Run studio:ingest first.`);
  }

  let resolvedConfig: ProjectConfig;
  try {
    resolvedConfig = parseYaml(await readFile(path.join(projectRoot, "config", "resolved.yaml"), "utf-8")) as ProjectConfig;
  } catch {
    throw new QcError(`No config/resolved.yaml found for "${options.projectSlug}". Run studio:design first.`);
  }

  let tokensCss: string;
  try {
    tokensCss = await readFile(path.join(projectRoot, "design", "tokens.css"), "utf-8");
  } catch {
    throw new QcError(`No design/tokens.css found for "${options.projectSlug}". Run studio:design first.`);
  }

  const outputPdfPath = await findOutputPdf(projectRoot, options.projectSlug);
  const pdfBytes = await readFile(outputPdfPath);
  const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const pageCount = pdfDoc.numPages;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    pageTexts.push(await extractPageText(page));
  }

  const bookHtmlResult = await findBookHtml(projectRoot, options.projectSlug);
  const previewsDir = path.join(projectRoot, "previews");
  const previewPaths = await listPreviews(previewsDir);

  const ctx: QcContext = {
    projectSlug: options.projectSlug,
    projectRoot,
    repoRoot,
    outputPdfPath: path.relative(projectRoot, outputPdfPath).split(path.sep).join("/"),
    pdfBytes,
    pdfDoc,
    pageCount,
    pageTexts,
    fullText: pageTexts.join("\n"),
    inventory,
    resolvedConfig,
    tokensCss,
    bookHtml: bookHtmlResult?.html ?? null,
    bookHtmlPath: bookHtmlResult?.htmlPath ?? null,
    previewsDir,
    previewPaths,
  };

  const checks: QcCheckResult[] = [];
  for (const check of CHECKS) {
    checks.push(await check(ctx));
  }

  const aesthetic = computeAestheticScore(ctx, checks);
  // "skipped" (nothing applicable to verify — e.g. no images in a text-only book) is never
  // silently counted as a pass (R8), but it also isn't a failure: only a "fail" (a condition
  // that WAS checked and came back bad) blocks GO. Every check's real status stays visible
  // per-row in the report either way.
  const overallPass = checks.every((c) => c.status !== "fail");

  const report: QcReport = {
    schemaVersion: 1,
    project: options.projectSlug,
    generatedAt: new Date().toISOString(),
    outputPdfPath: ctx.outputPdfPath,
    pageCount,
    checks,
    overallPass,
    aesthetic,
  };

  if (!validateQcReport(report)) {
    throw new QcError(`Generated qc-report failed schema validation: ${ajv.errorsText(validateQcReport.errors)}`);
  }

  const reportsDir = path.join(projectRoot, "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportJsonPath = path.join(reportsDir, "qc-report.json");
  const reportMdPath = path.join(reportsDir, "qc-report.md");
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(reportMdPath, renderReportMarkdown(report), "utf-8");

  return { report, reportJsonPath, reportMdPath };
}
