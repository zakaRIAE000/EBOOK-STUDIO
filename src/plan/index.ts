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

/** Words that place an item in a sequence rather than in an unordered set. */
const ORDINAL_WORD_RE = /\b(first|second|third|fourth|fifth|next|then|last|finally|afterwards?|before that|to begin|to start)\b/i;
/** A following block asserting that the order of the list above it matters. */
const ORDER_ASSERTION_RE = /\b(that|this)\s+(order|sequence)\s+matters?\b|\bin\s+(that|this)\s+order\b|\border\s+matters?\b/i;

/**
 * Chooses between `checklist` (order-independent criteria) and `process-steps`
 * (an ordered sequence).
 *
 * Ordinal signals are tested BEFORE the verb wording, and that precedence is
 * the whole point. Verb matching alone misclassified a list that was numbered
 * in the source, sat under a heading reading "The Questions In Order", named
 * each item's position ("Check the setup first… next… last"), and was followed
 * by "That order matters" — every available signal said sequence, but each item
 * happened to begin with "Check", so it was assigned `checklist`.
 *
 * That mistake is not cosmetic: `checklist` is documented as order-independent,
 * and it has no counter, so rendering an ordered list that way also drops the
 * source's own 1/2/3 markers. `process-steps` regenerates them via
 * counter(process-step), so the numbering survives.
 */
function classifyList(
  items: string[],
  context: { ordered: boolean; nextBlockText: string },
): { component: ComponentType; rule: string } {
  if (items.length < 3) {
    return { component: "editorial-body", rule: "ambiguous-leftover:short-list" };
  }

  const ordinalCount = items.filter((i) => ORDINAL_WORD_RE.test(i)).length;
  const assertsOrder = ORDER_ASSERTION_RE.test(context.nextBlockText);
  if (context.ordered && (ordinalCount >= 2 || assertsOrder)) {
    const why = assertsOrder ? "a following block asserts the order matters" : "items name their position";
    return { component: "process-steps", rule: `ordinal signal: numbered source and ${why}` };
  }

  const checklistCount = items.filter((i) => CHECKLIST_ITEM_RE.test(i)).length;
  if (checklistCount / items.length >= 0.6) {
    return { component: "checklist", rule: "check/do wording" };
  }
  if (context.ordered) {
    return { component: "process-steps", rule: "numbered list >=3 items" };
  }
  // An unordered list with no check wording is a plain bullet run: body copy
  // that happens to be listed, not a structured component. It stays
  // editorial-body and is laid out as a simple list.
  //
  // This branch used to be unreachable in practice, because inline `•` runs
  // never became list blocks at all — so every list reaching here was numbered,
  // and falling through to `process-steps` was silently correct. Once ingest
  // started emitting real unordered lists, that fall-through began labelling
  // plain bullet runs "numbered list >=3 items" and counting them toward the
  // structured-component budget, which is neither true nor useful.
  return { component: "editorial-body", rule: "unordered list, no ordering or check signal" };
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/** Text of whatever follows a block — a list's order can be asserted by the sentence after it. */
function blockText(block: MdBlock | undefined): string {
  if (!block) return "";
  if (block.kind === "list") return block.items.join(" ");
  if (block.kind === "table") return block.header.join(" ");
  return block.text;
}

function classifyBlock(block: MdBlock, index: number, next?: MdBlock): PlanBlock | null {
  switch (block.kind) {
    case "heading":
      return null; // structural, not a plannable content block

    case "list": {
      const { component, rule } = classifyList(block.items, {
        ordered: block.ordered,
        nextBlockText: blockText(next),
      });
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

/**
 * Front and back matter are exempt from the non-body component budget.
 *
 * `minNonBodyComponents` is `ceil(pages / 4)`, so it rounds up to 1 for any
 * non-zero page count. A short pure-prose introduction or conclusion — no list,
 * no table, no blockquote, no heading anywhere in the source — therefore trips
 * the warning by construction, and the only way to satisfy it would be to
 * manufacture a component, i.e. to manufacture text (R3). Both of this book's
 * matter sections had to have it explicitly overruled at their gates.
 *
 * A warning that can never be satisfied honestly trains its reader to ignore
 * it, which costs more than it catches.
 */
function isFrontOrBackMatter(chapterType: string | undefined): boolean {
  return chapterType === "introduction" || chapterType === "conclusion";
}

function planChapter(chapterId: string, markdown: string, wordCount: number, chapterType?: string): ChapterPlan {
  const mdBlocks = parseMarkdownBlocks(markdown);
  const blocks: PlanBlock[] = [];
  let contentIndex = 0;
  for (const [mdIndex, mdBlock] of mdBlocks.entries()) {
    const planned = classifyBlock(mdBlock, contentIndex, mdBlocks[mdIndex + 1]);
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
  if (actualNonBodyComponents < minNonBodyComponents && !isFrontOrBackMatter(chapterType)) {
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
    chapters.push(planChapter(chapter.id, markdown, chapter.wordCount, chapter.type));
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
