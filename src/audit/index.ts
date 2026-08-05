import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Inventory, InventoryBonus, InventoryChapter } from "../ingest/index.js";

export class AuditError extends Error {}

export interface AuditOptions {
  projectSlug: string;
  /** Defaults to workspace/projects relative to the repo root. */
  projectsRoot?: string;
}

export type AuditCategory =
  | "duplicate-heading"
  | "broken-characters"
  | "near-empty-section"
  | "malformed-list"
  | "truncated-paragraph"
  | "unfulfilled-heading";

export interface AuditFinding {
  category: AuditCategory;
  /** Project-relative path the finding applies to, or "inventory.json" for whole-book checks. */
  file: string;
  message: string;
}

export interface AuditReport {
  schemaVersion: 1;
  project: string;
  auditedAt: string;
  findingCount: number;
  findings: AuditFinding[];
  clean: boolean;
}

export interface AuditResult {
  report: AuditReport;
  projectRoot: string;
  reportPath: string;
}

function resolveProjectRoot(options: AuditOptions): string {
  const projectsRoot = options.projectsRoot ?? path.resolve(process.cwd(), "workspace/projects");
  return path.join(projectsRoot, options.projectSlug);
}

// --- Check 1: duplicate headings/titles --------------------------------------

/** Two chapters/bonuses sharing the same title is never intentional — a book never has two
 * chapters both called "Introduction" on purpose; it's the same source-duplication failure
 * mode ingest already guards against at the section level, checked again here at the whole-
 * inventory level as a second, independent pass. */
function findDuplicateTitles(inventory: Inventory, findings: AuditFinding[]): void {
  const entries: Array<InventoryChapter | InventoryBonus> = [...inventory.chapters, ...inventory.bonuses];
  const byTitle = new Map<string, string[]>();
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    const ids = byTitle.get(key) ?? [];
    ids.push(entry.id);
    byTitle.set(key, ids);
  }
  for (const [title, ids] of byTitle) {
    if (ids.length > 1) {
      findings.push({
        category: "duplicate-heading",
        file: "inventory.json",
        message: `Title "${title}" is shared by ${ids.length} entries: ${ids.join(", ")}.`,
      });
    }
  }
}

// --- Check 2: broken / mangled characters -------------------------------------

/**
 * Re-scans the final markdown files on disk — a second-layer safety net independent of
 * ingest's own detectControlCharacters (which only ever sees text at generation time, not
 * whatever ends up on disk afterward). Same signatures QC's no-broken-chars check uses
 * (U+FFFD, "(cid:") plus the C1 control range (U+0080-U+009F) that check doesn't cover.
 */
function findBrokenCharacters(markdown: string, relativeFile: string, findings: AuditFinding[]): void {
  const replacementCount = (markdown.match(/�/g) ?? []).length;
  if (replacementCount > 0) {
    findings.push({
      category: "broken-characters",
      file: relativeFile,
      message: `${replacementCount} U+FFFD replacement character(s) found — a glyph couldn't be mapped to a codepoint.`,
    });
  }

  const cidMatches = markdown.match(/\(cid:\d+\)/g) ?? [];
  if (cidMatches.length > 0) {
    findings.push({
      category: "broken-characters",
      file: relativeFile,
      message: `${cidMatches.length} "(cid:" marker(s) found — a font's ToUnicode CMap was likely missing during extraction.`,
    });
  }

  const controlMatch = markdown.match(/[-]/);
  if (controlMatch && controlMatch.index !== undefined) {
    const start = Math.max(0, controlMatch.index - 30);
    const snippet = markdown.slice(start, controlMatch.index + 60).replace(/\s+/g, " ");
    findings.push({
      category: "broken-characters",
      file: relativeFile,
      message: `C1 control character (U+0080-U+009F range) found — likely a source-generation artifact leaking into text. Context: "…${snippet}…".`,
    });
  }
}

// --- Check 3: near-empty pages/sections ---------------------------------------

/**
 * A near-zero word count on a multi-page chapter means extraction silently failed on that
 * section (skills/pdf-ingest/SKILL.md's own sanity-check #7). A fixed words-per-page floor
 * can't tell a genuine extraction failure from a deliberately terse book (or test fixture) —
 * a 3-page fixture with one short paragraph per section is not "broken," it's just short
 * everywhere. Instead, flag an entry whose density is an outlier *relative to this book's own
 * other sections*: well below the inventory's own median words/page. An absolute floor still
 * catches the degenerate case (near-zero words) even in a two-entry book where "median" isn't
 * a meaningful signal.
 */
const RELATIVE_DENSITY_FLOOR = 0.25;
const ABSOLUTE_WORD_FLOOR = 20;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function findNearEmptySections(inventory: Inventory, findings: AuditFinding[]): void {
  const entries: Array<InventoryChapter | InventoryBonus> = [...inventory.chapters, ...inventory.bonuses];
  const densities = entries.map((entry) => entry.wordCount / Math.max(1, entry.endPage - entry.startPage + 1));
  const medianDensity = entries.length >= 3 ? median(densities) : null;

  entries.forEach((entry, i) => {
    const pageSpan = Math.max(1, entry.endPage - entry.startPage + 1);
    const wordsPerPage = densities[i];
    const belowAbsoluteFloor = entry.wordCount < ABSOLUTE_WORD_FLOOR;
    const belowRelativeFloor = medianDensity !== null && wordsPerPage < medianDensity * RELATIVE_DENSITY_FLOOR;
    if (belowAbsoluteFloor || belowRelativeFloor) {
      const comparison = belowRelativeFloor
        ? ` — this book's median is ~${medianDensity!.toFixed(1)} words/page`
        : " — near-zero regardless of book density";
      findings.push({
        category: "near-empty-section",
        file: entry.file,
        message: `"${entry.title}" has only ${entry.wordCount} word(s) across ${pageSpan} page(s) (~${wordsPerPage.toFixed(1)} words/page)${comparison}, likely a silent extraction failure rather than genuinely sparse content.`,
      });
    }
  });
}

// --- Check 4: malformed lists --------------------------------------------------

const LIST_LINE_RE = /^\s*(\d+)[.)]\s+\S/;

const TERMINAL_PUNCTUATION_RE = /[.!?]["')\]]?$/;
const CONTINUATION_START_RE = /^[•\-*]|^[a-z]/;

/**
 * A numbered list ingest wrote out (content/plan/index.ts and render both assume markdown
 * numbering is trustworthy) should always run 1, 2, 3... with no gaps or repeats. Scans
 * blank-line-separated blocks in the final markdown — the same block boundaries ingest itself
 * writes — for any numbered-list-looking block that doesn't.
 */
function findMalformedLists(markdown: string, relativeFile: string, findings: AuditFinding[]): void {
  const blocks = markdown.split(/\n\n+/);
  for (let idx = 0; idx < blocks.length; idx++) {
    const lines = blocks[idx]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const matches = lines.map((l) => l.match(LIST_LINE_RE));
    if (!matches.every((m) => m !== null)) continue;
    const numbers = matches.map((m) => parseInt(m![1], 10));

    if (numbers.length > 1) {
      const isSequentialFromOne = numbers.every((n, i) => n === i + 1);
      if (!isSequentialFromOne) {
        findings.push({
          category: "malformed-list",
          file: relativeFile,
          message: `Numbered list does not run sequentially from 1: found [${numbers.join(", ")}] in a ${lines.length}-item block starting "${lines[0].slice(0, 60)}".`,
        });
      }
      continue;
    }

    // A lone item numbered exactly 1 trivially satisfies "sequential from 1" — the same
    // check that correctly flags an isolated [2], [3]... block is blind to an isolated [1]
    // block, even though it can be exactly the same kind of fragment (ingest's buildBlocks
    // now absorbs genuine wrapped continuations — see src/ingest/index.ts — so this is a
    // second-layer, text-only safety net for whatever still slips through). Apply the same
    // fragment suspicion here: does the item's own text look cut off (no terminal
    // punctuation), or does the next block read like it picks the sentence back up (starts
    // lowercase, or with a bullet character riding under a short field-header item)?
    const itemText = lines[0].replace(/^\s*\d+[.)]\s+/, "").trim();
    const nextBlock = (blocks[idx + 1] ?? "").trim();
    if (!nextBlock) continue;
    const looksTruncated = !TERMINAL_PUNCTUATION_RE.test(itemText);
    const nextLooksLikeContinuation = CONTINUATION_START_RE.test(nextBlock);
    if (looksTruncated || nextLooksLikeContinuation) {
      findings.push({
        category: "malformed-list",
        file: relativeFile,
        message: `Possible list fragment: a single-item block "${numbers[0]}. ${itemText.slice(0, 60)}" is immediately followed by "${nextBlock.slice(0, 60)}", which reads like a continuation rather than a new topic — may be an orphaned piece of a longer list.`,
      });
    }
  }
}

// --- Orchestration -------------------------------------------------------------

/**
 * Flags any prose paragraph that does not end in terminal punctuation.
 *
 * Deliberately independent of the ingest-side cross-page join. That fix is
 * geometric-plus-punctuation and deliberately strict — it only joins when the
 * continuation also starts lowercase, so a sentence resuming on a proper noun
 * stays split. This check has no such condition and no notion of pages, so it
 * catches whatever the engine misses, including truncation the source shipped
 * that no join could repair.
 *
 * Reporting only, never a gate: a heading rendered as a paragraph, or a
 * deliberately clipped line, are both legitimate reasons to end without a full
 * stop. The point is that a human sees it at /ingest rather than discovering it
 * mid-layout, which is how all twelve of this book's splits were found.
 */
function findTruncatedParagraphs(markdown: string, relativeFile: string, findings: AuditFinding[]): void {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    if (/^#{1,6}\s/.test(block)) continue; // heading
    if (/^[>|]/.test(block)) continue; // blockquote or table
    if (/^([-*]|\d+[.)])\s/m.test(block)) continue; // list — items may legitimately lack punctuation
    // Section headings reach the markdown as bare paragraph lines (the pipeline
    // carries no heading sourceKind), and a heading correctly has no full stop.
    // Shape, not punctuation, is what separates them from truncated prose: one
    // line, few words. A sentence cut by a page break is a whole paragraph.
    const isHeadingShaped = !block.includes("\n") && block.split(/\s+/).length <= 10;
    if (isHeadingShaped) continue;
    if (TERMINAL_PUNCTUATION_RE.test(block) || /[:;,"'’”)\]]$/.test(block)) continue;

    findings.push({
      category: "truncated-paragraph",
      file: relativeFile,
      message: `A paragraph ends without terminal punctuation: "…${block.slice(-60)}". Often a sentence cut by a source page break, or a heading that arrived as body text.`,
    });
  }
}

/** Headings whose wording promises a structure the section then has to contain. */
const STRUCTURAL_PROMISE_RE =
  /\b(do(e?s)?\s+and\s+(don'?ts?|do\s*nots?)|pros\s+and\s+cons|before\s+and\s+after|dos?\s*\/\s*don'?ts?)\b|^\s*\d+\s+(ways?|steps?|rules?|reasons?|things?|mistakes?)\b|\bthe\s+\d+\s+(ways?|steps?|rules?|reasons?|checks?)\b|\bvs\.?\b|\bversus\b/i;

/**
 * Flags a heading that promises a specific structure when the section beneath
 * it does not deliver one.
 *
 * Two independent signals, either sufficient: the section contains no list at
 * all, or its body is unusually thin against the book's OWN median section
 * length. The threshold is relative for the same reason the near-empty check
 * had to be — an absolute word floor false-flagged the test fixture's
 * legitimately short sections.
 *
 * Reporting only. Whether a thin section is a defect or an authorial choice is
 * a human call; the point is that it surfaces at /ingest instead of at layout,
 * which is where this book's instance ("Do And Don't At The Sizing Line",
 * promising a do/don't list the source never contained) was actually caught.
 */
function findUnfulfilledHeadings(markdown: string, relativeFile: string, findings: AuditFinding[]): void {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  // Section = a heading-shaped line plus everything up to the next one.
  const isHeadingLike = (b: string) =>
    /^#{1,6}\s/.test(b) || (b.split("\n").length === 1 && b.split(/\s+/).length <= 10 && !/[.!?]$/.test(b));

  const sections: { heading: string; body: string[] }[] = [];
  for (const block of blocks) {
    if (isHeadingLike(block)) sections.push({ heading: block.replace(/^#+\s*/, ""), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(block);
  }

  const bodyWords = sections.map((s) => s.body.join(" ").split(/\s+/).filter(Boolean).length);
  const medianWords = median(bodyWords.filter((n) => n > 0));

  sections.forEach((section, i) => {
    if (!STRUCTURAL_PROMISE_RE.test(section.heading)) return;
    const hasList = section.body.some((b) => /^([-*]|\d+[.)])\s/m.test(b));
    const words = bodyWords[i];
    const thin = medianWords > 0 && words < medianWords * RELATIVE_DENSITY_FLOOR;
    if (hasList && !thin) return;

    const why = !hasList && thin ? "contains no list and is unusually thin" : !hasList ? "contains no list" : "is unusually thin";
    findings.push({
      category: "unfulfilled-heading",
      file: relativeFile,
      message: `Heading "${section.heading}" promises a specific structure, but the section beneath it ${why} (${words} words vs a ${medianWords.toFixed(0)}-word median for this file). Source may have lost content at generation.`,
    });
  });
}

function renderReportMarkdown(report: AuditReport): string {
  const lines: string[] = [
    `# Content audit — ${report.project}`,
    "",
    `Generated ${report.auditedAt}.`,
    "",
    `## Result: ${report.clean ? "✅ Clean — no issues detected" : `⚠️ ${report.findingCount} issue(s) found`}`,
    "",
  ];

  if (report.clean) {
    lines.push("No duplicate headings/titles, broken characters, near-empty sections, or malformed lists detected.", "");
  } else {
    const categories: AuditCategory[] = ["duplicate-heading", "broken-characters", "near-empty-section", "malformed-list", "truncated-paragraph", "unfulfilled-heading"];
    const labels: Record<AuditCategory, string> = {
      "duplicate-heading": "Duplicate headings/titles",
      "broken-characters": "Broken/mangled characters",
      "near-empty-section": "Near-empty pages/sections",
      "malformed-list": "Malformed lists",
      "truncated-paragraph": "Paragraphs ending mid-sentence",
      "unfulfilled-heading": "Headings promising a structure the section lacks",
    };
    for (const category of categories) {
      const inCategory = report.findings.filter((f) => f.category === category);
      if (inCategory.length === 0) continue;
      lines.push(`## ${labels[category]} (${inCategory.length})`, "", "| File | Finding |", "|---|---|");
      for (const finding of inCategory) {
        lines.push(`| \`${finding.file}\` | ${finding.message.replace(/\|/g, "\\|")} |`);
      }
      lines.push("");
    }
  }

  lines.push(
    "This is a detection/reporting pass, not a pass/fail gate (that's `studio:qc`) — findings are for human review at or before `/design-system`, not a blocker on their own.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

export async function auditProject(options: AuditOptions): Promise<AuditResult> {
  const projectRoot = resolveProjectRoot(options);

  let inventory: Inventory;
  try {
    inventory = JSON.parse(await readFile(path.join(projectRoot, "inventory.json"), "utf-8")) as Inventory;
  } catch {
    throw new AuditError(`No inventory.json found for "${options.projectSlug}". Run studio:ingest first.`);
  }

  const findings: AuditFinding[] = [];
  findDuplicateTitles(inventory, findings);
  findNearEmptySections(inventory, findings);

  const entries: Array<InventoryChapter | InventoryBonus> = [...inventory.chapters, ...inventory.bonuses];
  for (const entry of entries) {
    const filePath = path.join(projectRoot, entry.file);
    let markdown: string;
    try {
      markdown = await readFile(filePath, "utf-8");
    } catch {
      throw new AuditError(`inventory.json references "${entry.file}" but it does not exist on disk. Re-run studio:ingest.`);
    }
    findBrokenCharacters(markdown, entry.file, findings);
    findMalformedLists(markdown, entry.file, findings);
    findTruncatedParagraphs(markdown, entry.file, findings);
    findUnfulfilledHeadings(markdown, entry.file, findings);
  }

  const report: AuditReport = {
    schemaVersion: 1,
    project: options.projectSlug,
    auditedAt: new Date().toISOString(),
    findingCount: findings.length,
    findings,
    clean: findings.length === 0,
  };

  const reportsDir = path.join(projectRoot, "reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, "content-audit.md");
  await writeFile(reportPath, renderReportMarkdown(report), "utf-8");

  return { report, projectRoot, reportPath };
}
