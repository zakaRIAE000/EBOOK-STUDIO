import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv } from "ajv";
import pagePlanSchema from "../../schemas/page-plan.schema.json" with { type: "json" };
import type { Inventory } from "../ingest/index.js";

export class PlanError extends Error {}

// --- Public types -------------------------------------------------------

export interface PlanOptions {
  projectSlug: string;
  /** Defaults to workspace/projects relative to the repo root. */
  projectsRoot?: string;
}

export type ComponentType =
  | "editorial-body"
  | "process-steps"
  | "checklist"
  | "comparison-table"
  | "calculation-card"
  | "warning-callout"
  | "tip-callout"
  | "key-takeaways"
  | "pull-quote";

export type SourceKind = "heading" | "paragraph" | "list" | "table" | "blockquote";

export interface PlanBlock {
  index: number;
  component: ComponentType;
  sourceKind: SourceKind;
  rule: string;
  preview: string;
}

export interface ChapterPlan {
  chapterId: string;
  blocks: PlanBlock[];
  componentCounts: Record<string, number>;
  editorialBodyRatio: number;
  estimatedPages: number;
  minNonBodyComponents: number;
  actualNonBodyComponents: number;
  warnings: string[];
}

export interface PagePlan {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  chapters: ChapterPlan[];
}

export interface PlanResult {
  pagePlan: PagePlan;
  projectRoot: string;
  pagePlanPath: string;
  coverageReportPath: string;
}

// --- Markdown block parsing (independent of src/ingest — operates on the
// already-written .md files, the single source of truth for chapter text) --

type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "blockquote"; text: string };

const ORDERED_ITEM_RE = /^\d+[.)]\s+(.*)$/;
const UNORDERED_ITEM_RE = /^[-*]\s+(.*)$/;

function parseMarkdownBlocks(markdown: string): MdBlock[] {
  const chunks = markdown.split(/\n\s*\n+/).map((c) => c.trim()).filter(Boolean);
  const blocks: MdBlock[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim());

    const headingMatch = lines[0].match(/^(#{1,6})\s+(.*)$/);
    if (lines.length === 1 && headingMatch) {
      blocks.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }

    if (lines.every((l) => l.startsWith("|"))) {
      const cellsOf = (line: string) =>
        line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cellsOf(lines[0]);
      const rows = lines.slice(2).map(cellsOf); // lines[1] is the --- separator
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (lines.every((l) => ORDERED_ITEM_RE.test(l))) {
      blocks.push({ kind: "list", ordered: true, items: lines.map((l) => l.match(ORDERED_ITEM_RE)![1].trim()) });
      continue;
    }

    if (lines.every((l) => UNORDERED_ITEM_RE.test(l))) {
      blocks.push({ kind: "list", ordered: false, items: lines.map((l) => l.match(UNORDERED_ITEM_RE)![1].trim()) });
      continue;
    }

    if (lines.every((l) => l.startsWith(">"))) {
      blocks.push({ kind: "blockquote", text: lines.map((l) => l.replace(/^>\s?/, "")).join(" ").trim() });
      continue;
    }

    blocks.push({ kind: "paragraph", text: lines.join(" ") });
  }

  return blocks;
}

// --- Deterministic classification rules --------------------------------

const WARNING_RE = /^(warning|caution|never|important)\b\s*[:.\-–]?/i;
const CHECKLIST_ITEM_RE = /^(check|verify|confirm|ensure|make sure|double-check|review that|test that)\b/i;
const CALCULATION_RE = /=.*[-+*/%]|[-+*/%].*=/;
const CALCULATION_MAX_LEN = 200;

function classifyList(items: string[]): { component: ComponentType; rule: string } {
  if (items.length < 3) {
    return { component: "editorial-body", rule: "ambiguous-leftover:short-list" };
  }
  const checklistCount = items.filter((i) => CHECKLIST_ITEM_RE.test(i)).length;
  if (checklistCount / items.length >= 0.6) {
    return { component: "checklist", rule: "check/do wording" };
  }
  return { component: "process-steps", rule: "numbered list >=3 items" };
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function classifyBlock(block: MdBlock, index: number): PlanBlock | null {
  switch (block.kind) {
    case "heading":
      return null; // structural, not a plannable content block

    case "list": {
      const { component, rule } = classifyList(block.items);
      return { index, component, sourceKind: "list", rule, preview: preview(block.items.join(" / ")) };
    }

    case "table": {
      const columnCount = block.header.length;
      if (columnCount <= 4) {
        return {
          index,
          component: "comparison-table",
          sourceKind: "table",
          rule: `table with ${columnCount} columns (<=4)`,
          preview: preview(block.header.join(" | ")),
        };
      }
      return {
        index,
        component: "editorial-body",
        sourceKind: "table",
        rule: `table with ${columnCount} columns (>4, stays in body)`,
        preview: preview(block.header.join(" | ")),
      };
    }

    case "blockquote":
      return { index, component: "pull-quote", sourceKind: "blockquote", rule: "blockquote", preview: preview(block.text) };

    case "paragraph": {
      if (WARNING_RE.test(block.text.trim())) {
        return { index, component: "warning-callout", sourceKind: "paragraph", rule: "starts with Warning/Caution/Never/Important", preview: preview(block.text) };
      }
      if (block.text.length <= CALCULATION_MAX_LEN && CALCULATION_RE.test(block.text)) {
        return { index, component: "calculation-card", sourceKind: "paragraph", rule: "formula (= with an operator, short paragraph)", preview: preview(block.text) };
      }
      return { index, component: "editorial-body", sourceKind: "paragraph", rule: "default", preview: preview(block.text) };
    }
  }
}

const WORDS_PER_PAGE = 275; // heuristic for 11pt/1.55 line-height body copy at 6x9in trim

function planChapter(chapterId: string, markdown: string, wordCount: number): ChapterPlan {
  const mdBlocks = parseMarkdownBlocks(markdown);
  const blocks: PlanBlock[] = [];
  let contentIndex = 0;
  for (const mdBlock of mdBlocks) {
    const planned = classifyBlock(mdBlock, contentIndex);
    if (planned) {
      blocks.push(planned);
      contentIndex++;
    }
  }

  // Chapter-final summary rule: the last content block, when it's a list,
  // is the chapter's summary/recap rather than a mid-chapter process or
  // checklist — position overrides the generic list classification.
  const last = blocks[blocks.length - 1];
  if (last && last.sourceKind === "list" && (last.component === "process-steps" || last.component === "checklist")) {
    last.component = "key-takeaways";
    last.rule = "chapter-final summary (last block)";
  }

  // Budget: max 1 pull-quote per chapter — extras fall back to editorial-body.
  let pullQuoteSeen = false;
  for (const b of blocks) {
    if (b.component === "pull-quote") {
      if (pullQuoteSeen) {
        b.component = "editorial-body";
        b.rule += " (budget: only 1 pull-quote/chapter — extra kept in body)";
      }
      pullQuoteSeen = true;
    }
  }

  const componentCounts: Record<string, number> = {};
  for (const b of blocks) componentCounts[b.component] = (componentCounts[b.component] ?? 0) + 1;

  const editorialBodyCount = componentCounts["editorial-body"] ?? 0;
  const editorialBodyRatio = blocks.length > 0 ? editorialBodyCount / blocks.length : 0;

  const estimatedPages = wordCount / WORDS_PER_PAGE;
  const minNonBodyComponents = Math.ceil(estimatedPages / 4);
  const actualNonBodyComponents = blocks.length - editorialBodyCount;

  const warnings: string[] = [];
  if (editorialBodyRatio > 0.7) {
    warnings.push(
      `editorial-body is ${(editorialBodyRatio * 100).toFixed(0)}% of this chapter's blocks (>70%) — mostly plain prose, few structured components.`,
    );
  }
  if (actualNonBodyComponents < minNonBodyComponents) {
    warnings.push(
      `only ${actualNonBodyComponents} non-body component(s) across an estimated ${estimatedPages.toFixed(1)} page(s) — budget wants >=1 per 4 pages (>= ${minNonBodyComponents}).`,
    );
  }
  const ambiguousCount = blocks.filter((b) => b.rule.startsWith("ambiguous-leftover")).length;
  if (ambiguousCount > 0) {
    warnings.push(
      `${ambiguousCount} ambiguous leftover block(s) defaulted to editorial-body — review during /chapter (max 1 in-session override allowed).`,
    );
  }

  return { chapterId, blocks, componentCounts, editorialBodyRatio, estimatedPages, minNonBodyComponents, actualNonBodyComponents, warnings };
}

// --- Report ----------------------------------------------------------------

function renderCoverageReport(plan: PagePlan): string {
  const lines: string[] = [`# Plan coverage — ${plan.project}`, "", `Generated ${plan.generatedAt}.`, ""];

  for (const chapter of plan.chapters) {
    lines.push(`## ${chapter.chapterId}`, "");
    lines.push(`- Blocks: ${chapter.blocks.length}`);
    lines.push(`- Estimated pages: ${chapter.estimatedPages.toFixed(1)}`);
    lines.push(`- Editorial-body ratio: ${(chapter.editorialBodyRatio * 100).toFixed(0)}%`);
    lines.push(`- Non-body components: ${chapter.actualNonBodyComponents} (budget minimum: ${chapter.minNonBodyComponents})`);
    lines.push("");
    lines.push("| # | Component | Source | Rule |");
    lines.push("|---|---|---|---|");
    for (const b of chapter.blocks) {
      lines.push(`| ${b.index} | ${b.component} | ${b.sourceKind} | ${b.rule} |`);
    }
    lines.push("");
    if (chapter.warnings.length > 0) {
      lines.push("**Warnings:**");
      for (const w of chapter.warnings) lines.push(`- ${w}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

// --- Orchestration -----------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
const validatePagePlan = ajv.compile(pagePlanSchema);

function resolveProjectRoot(options: PlanOptions): string {
  const projectsRoot = options.projectsRoot ?? path.resolve(process.cwd(), "workspace/projects");
  return path.join(projectsRoot, options.projectSlug);
}

export async function planProject(options: PlanOptions): Promise<PlanResult> {
  const projectRoot = resolveProjectRoot(options);
  const inventoryPath = path.join(projectRoot, "inventory.json");

  let inventory: Inventory;
  try {
    inventory = JSON.parse(await readFile(inventoryPath, "utf-8")) as Inventory;
  } catch {
    throw new PlanError(`No inventory.json found at ${inventoryPath}. Run studio:ingest first.`);
  }

  const chapters: ChapterPlan[] = [];
  for (const chapter of inventory.chapters) {
    const markdown = await readFile(path.join(projectRoot, chapter.file), "utf-8");
    chapters.push(planChapter(chapter.id, markdown, chapter.wordCount));
  }

  const pagePlan: PagePlan = {
    schemaVersion: 1,
    project: options.projectSlug,
    generatedAt: new Date().toISOString(),
    chapters,
  };

  if (!validatePagePlan(pagePlan)) {
    throw new PlanError(`Generated page-plan failed schema validation: ${ajv.errorsText(validatePagePlan.errors)}`);
  }

  const designDir = path.join(projectRoot, "design");
  const reportsDir = path.join(projectRoot, "reports");
  await mkdir(designDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const pagePlanPath = path.join(designDir, "page-plan.json");
  await writeFile(pagePlanPath, `${JSON.stringify(pagePlan, null, 2)}\n`, "utf-8");

  const coverageReportPath = path.join(reportsDir, "plan-coverage.md");
  await writeFile(coverageReportPath, renderCoverageReport(pagePlan), "utf-8");

  return { pagePlan, projectRoot, pagePlanPath, coverageReportPath };
}
