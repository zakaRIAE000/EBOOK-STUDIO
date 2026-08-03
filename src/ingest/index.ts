import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv } from "ajv";
import inventorySchema from "../../schemas/inventory.schema.json" with { type: "json" };

export class IngestError extends Error {}

// --- Public types -----------------------------------------------------------

export interface IngestOptions {
  projectSlug: string;
  /** Defaults to workspace/projects relative to the repo root. */
  projectsRoot?: string;
}

export interface InventoryChapter {
  id: string;
  type: "introduction" | "chapter" | "conclusion" | "unclassified";
  number: number | null;
  title: string;
  file: string;
  startPage: number;
  endPage: number;
  wordCount: number;
}

export interface InventoryBonus {
  id: string;
  title: string;
  file: string;
  startPage: number;
  endPage: number;
  wordCount: number;
}

export interface Inventory {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  extractedAt: string;
  pageCount: number;
  fallbackUsed: boolean;
  chapters: InventoryChapter[];
  bonuses: InventoryBonus[];
  warnings: string[];
}

export interface IngestResult {
  inventory: Inventory;
  projectRoot: string;
  inventoryPath: string;
}

// --- Text extraction primitives ---------------------------------------------

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawLine {
  page: number;
  y: number;
  fontHeight: number;
  cells: string[];
}

interface ClassifiedLine {
  page: number;
  y: number;
  fontHeight: number;
  text: string;
  cells: string[];
  isListItem: boolean;
  isTableRow: boolean;
}

const Y_GROUP_TOLERANCE = 2;
/** A horizontal gap wider than this (relative to font height) means "new table column", not "word space". */
const COLUMN_GAP_FONT_RATIO = 1.3;
const COLUMN_GAP_MIN_PT = 14;
/**
 * A vertical gap up to this multiple of font height is a plain CSS line-height wrap
 * (same paragraph); wider gaps carry paragraph margin and mark a new block. Empirically,
 * within-paragraph line-wrap gaps top out well below paragraph-break gaps (measured across
 * a real Synthesise AI source: wraps cluster at 1.2-2.42x font height, paragraph/section
 * breaks start at 2.51x with a clean gap between the two clusters) — 2.46 sits in that gap.
 * Also comfortably merges the fixture's 1.5 line-height (18pt gap at 12pt type).
 */
const PARAGRAPH_LINE_GAP_RATIO = 2.46;
/**
 * The boundary, inside a list, between "this line still belongs to the list" and "the list
 * ended here". Serves both list-internal joins: a list item's own continuation (a wrapped
 * sentence, or a bullet/description line under a field-header item), and the separation
 * between one numbered item and the next. Measured separately from PARAGRAPH_LINE_GAP_RATIO
 * because list gaps run wider than plain body-text line-wraps. Empirically, across the whole
 * book: marker-to-continuation gaps cluster at 1.75-2.75x font height and item-to-item gaps at
 * 1.75-2.42x, while the transition out of a list — into a new paragraph, or into an unrelated
 * block that merely starts with a digit — consistently sits at 3.08x, with no strays between.
 * 2.9 sits in that gap.
 */
const LIST_ITEM_GAP_RATIO = 2.9;
const LIST_ITEM_RE = /^\s*\d+[.)]\s+\S/;

function groupItemsIntoLines(items: RawTextItem[], page: number): RawLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawTextItem[][] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= Y_GROUP_TOLERANCE) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((lineItems) => {
    const ordered = [...lineItems].sort((a, b) => a.x - b.x);
    const fontHeight = Math.max(...ordered.map((it) => it.height));
    const cells: string[] = [];
    let buffer = "";
    let prevEndX: number | null = null;
    for (const item of ordered) {
      const text = item.str;
      if (text.trim() === "") continue;
      if (prevEndX === null) {
        buffer = text;
      } else {
        const gap = item.x - prevEndX;
        const columnThreshold = Math.max(fontHeight * COLUMN_GAP_FONT_RATIO, COLUMN_GAP_MIN_PT);
        if (gap > columnThreshold) {
          cells.push(buffer.trim());
          buffer = text;
        } else if (gap > fontHeight * 0.15) {
          buffer += ` ${text}`;
        } else {
          buffer += text;
        }
      }
      prevEndX = item.x + item.width;
    }
    if (buffer.trim() !== "") cells.push(buffer.trim());

    return {
      page,
      y: ordered[0].y,
      fontHeight,
      cells: cells.length > 0 ? cells : [""],
    };
  });
}

function classifyLine(line: RawLine): ClassifiedLine {
  const isTableRow = line.cells.length >= 2;
  const text = line.cells.join(" ");
  return {
    page: line.page,
    y: line.y,
    fontHeight: line.fontHeight,
    text,
    cells: line.cells,
    isTableRow,
    isListItem: !isTableRow && LIST_ITEM_RE.test(text.trim()),
  };
}

// --- Heading detection --------------------------------------------------

type SectionKind = "introduction" | "chapter" | "conclusion" | "bonus";

interface HeadingMatch {
  kind: SectionKind;
  number: number | null;
  inlineTitle: string;
}

function matchHeading(text: string): HeadingMatch | null {
  const trimmed = text.trim();
  if (/^introduction$/i.test(trimmed)) return { kind: "introduction", number: null, inlineTitle: "" };
  if (/^conclusion$/i.test(trimmed)) return { kind: "conclusion", number: null, inlineTitle: "" };

  const chapterMatch = trimmed.match(/^chapter\s+(\d+)\s*[:.\-–]?\s*(.*)$/i);
  if (chapterMatch) {
    return { kind: "chapter", number: parseInt(chapterMatch[1], 10), inlineTitle: chapterMatch[2].trim() };
  }

  const bonusMatch = trimmed.match(/^bonus\b\s*[:.\-–]?\s*(.*)$/i);
  if (bonusMatch) {
    return { kind: "bonus", number: null, inlineTitle: bonusMatch[1].trim() };
  }

  return null;
}

interface Section {
  kind: SectionKind;
  number: number | null;
  title: string;
  /** True when `title` was pulled from a separate line after the heading (needs its own markdown subtitle). */
  titleFromNextLine: boolean;
  headingText: string;
  startPage: number;
  endPage: number;
  bodyLines: ClassifiedLine[];
}

function segmentDocument(lines: ClassifiedLine[], warnings: string[]): Section[] {
  const headingPositions: { index: number; match: HeadingMatch }[] = [];
  lines.forEach((line, index) => {
    if (line.isTableRow) return;
    const match = matchHeading(line.text);
    if (match) headingPositions.push({ index, match });
  });

  if (headingPositions.length === 0) return [];

  if (headingPositions[0].index > 0) {
    warnings.push(
      `${headingPositions[0].index} line(s) before the first detected heading (page ${lines[0].page}) were not attached to any section and were dropped.`,
    );
  }

  const sections: Section[] = [];
  for (let h = 0; h < headingPositions.length; h++) {
    const { index: headingIndex, match } = headingPositions[h];
    const boundary = h + 1 < headingPositions.length ? headingPositions[h + 1].index : lines.length;
    const headingLine = lines[headingIndex];

    let title = match.inlineTitle;
    let bodyStart = headingIndex + 1;
    let titleFromNextLine = false;

    if (match.kind === "introduction") title = "Introduction";
    else if (match.kind === "conclusion") title = "Conclusion";
    else if (title === "") {
      const next = lines[headingIndex + 1];
      const nextIsUsable =
        next && headingIndex + 1 < boundary && !next.isListItem && !next.isTableRow && !matchHeading(next.text);
      if (nextIsUsable) {
        title = next.text.trim();
        bodyStart = headingIndex + 2;
        titleFromNextLine = true;
      } else {
        warnings.push(`${match.kind} heading "${headingLine.text}" (page ${headingLine.page}) has no detected title.`);
      }
    }

    const bodyLines = lines.slice(bodyStart, boundary);
    sections.push({
      kind: match.kind,
      number: match.number,
      title,
      titleFromNextLine,
      headingText: headingLine.text,
      startPage: headingLine.page,
      endPage: bodyLines.length > 0 ? bodyLines[bodyLines.length - 1].page : headingLine.page,
      bodyLines,
    });
  }

  return mergeOrphanedDividerHeadings(sections, warnings);
}

/**
 * Synthesise AI's source occasionally emits a bare divider heading (e.g. an all-caps
 * "INTRODUCTION" title-page marker with no body) immediately before the real section of
 * the same kind/title/number. That is a source-generation duplicate, not two sections —
 * drop the empty one and keep the one with real content.
 */
function mergeOrphanedDividerHeadings(sections: Section[], warnings: string[]): Section[] {
  const merged: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const isOrphanedDivider =
      section.bodyLines.length === 0 &&
      next !== undefined &&
      next.kind === section.kind &&
      next.title === section.title &&
      next.number === section.number;
    if (isOrphanedDivider) {
      warnings.push(
        `Dropped an empty "${section.kind}" divider heading "${section.headingText}" (page ${section.startPage}) immediately followed by the real "${next.title}" section on page ${next.startPage} — an orphaned duplicate heading from the source, not a second section.`,
      );
      continue;
    }
    merged.push(section);
  }
  return merged;
}

// --- Block reconstruction (paragraphs / lists / tables) ---------------------

type Block =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][] };

/**
 * True when `candidate` is a plain line-wrap continuation of `prev` — same page, same font
 * size (a font-size change, e.g. an 18pt sub-heading meeting 12pt body text, is always a new
 * block regardless of gap), and a vertical gap within `maxRatio`. Shared by both the paragraph
 * branch (PARAGRAPH_LINE_GAP_RATIO) and the list branch (LIST_ITEM_GAP_RATIO) below — same
 * mechanism, different empirically-measured tolerance per context.
 */
function isLineWrapContinuation(prev: ClassifiedLine, candidate: ClassifiedLine, maxRatio: number): boolean {
  if (candidate.page !== prev.page) return false;
  if (Math.abs(candidate.fontHeight - prev.fontHeight) > 0.5) return false;
  const avgFontHeight = (candidate.fontHeight + prev.fontHeight) / 2;
  const gap = prev.y - candidate.y;
  return gap <= avgFontHeight * maxRatio;
}

/**
 * True when `candidate` — a line that carries its own digit marker — is the next item of the
 * same list as `prev`, rather than the first line of an unrelated block that merely happens to
 * start with a digit. Without this, any such block gets silently welded onto the preceding list.
 *
 * Unlike isLineWrapContinuation, a page break is deliberately NOT a boundary here: a numbered
 * list legitimately runs across a page (this book's worksheet spans items 6 -> 7 that way), and
 * y-coordinates on two different pages aren't comparable, so only same-page gaps are measured.
 * Font height is likewise not checked — a marker and the bullet line above it can legitimately
 * differ in style while belonging to the same list.
 */
function isListItemSeparation(prev: ClassifiedLine, candidate: ClassifiedLine): boolean {
  if (candidate.page !== prev.page) return true;
  const avgFontHeight = (candidate.fontHeight + prev.fontHeight) / 2;
  const gap = prev.y - candidate.y;
  return gap <= avgFontHeight * LIST_ITEM_GAP_RATIO;
}

function buildBlocks(lines: ClassifiedLine[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.isListItem) {
      const items: string[] = [];
      let currentItem = line.text.trim();
      let prev = line;
      i++;
      while (i < lines.length) {
        const candidate = lines[i];
        if (candidate.isTableRow) break;
        if (candidate.isListItem) {
          // Carrying a digit marker isn't enough to make this the list's next item — it also
          // has to sit at list spacing. A marker further down the page begins an unrelated
          // block; continuing into it would silently merge two separate lists.
          if (!isListItemSeparation(prev, candidate)) break;
          items.push(currentItem);
          currentItem = candidate.text.trim();
          prev = candidate;
          i++;
          continue;
        }
        // Not a new numbered item — absorb it into the current item if it's riding at
        // normal within-item spacing (a wrapped continuation of the item's own sentence,
        // or a bullet/description line under a short field-header item); a real paragraph
        // break ends the list here instead.
        if (!isLineWrapContinuation(prev, candidate, LIST_ITEM_GAP_RATIO)) break;
        currentItem += ` ${candidate.text.trim()}`;
        prev = candidate;
        i++;
      }
      items.push(currentItem);
      blocks.push({ type: "list", items });
      continue;
    }

    if (line.isTableRow) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].isTableRow) {
        rows.push(lines[i].cells);
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    let text = line.text.trim();
    let prev = line;
    i++;
    while (i < lines.length) {
      const candidate = lines[i];
      if (candidate.isListItem || candidate.isTableRow) break;
      if (!isLineWrapContinuation(prev, candidate, PARAGRAPH_LINE_GAP_RATIO)) break;
      text += ` ${candidate.text.trim()}`;
      prev = candidate;
      i++;
    }
    blocks.push({ type: "paragraph", text });
  }
  return blocks;
}

/**
 * Drops a paragraph block whose text is byte-identical to the block right before it.
 * Genuine prose never repeats a full paragraph back-to-back with nothing in between —
 * this is the Synthesise AI source's duplicate-emit bug (same family as the orphaned
 * divider headings above), caught here at the block level instead of the section level.
 */
function dedupeConsecutiveParagraphs(blocks: Block[], sectionTitle: string, page: number, warnings: string[]): Block[] {
  const deduped: Block[] = [];
  for (const block of blocks) {
    const prev = deduped[deduped.length - 1];
    if (block.type === "paragraph" && prev?.type === "paragraph" && prev.text === block.text) {
      warnings.push(
        `Dropped a duplicate paragraph in "${sectionTitle}" (page ${page}): "${block.text.slice(0, 80)}${block.text.length > 80 ? "…" : ""}" appeared twice back-to-back — a source-generation duplicate, not intentional repetition.`,
      );
      continue;
    }
    deduped.push(block);
  }
  return deduped;
}

/**
 * Recognizes a callout/tip component whose structured props leaked into the text layer as a
 * stringified object instead of being rendered as a visual box — e.g. a source-generation run
 * reading `[CTRL]CALLOUT[CTRL]KIND[ª]TIP, EYEBROW[ª]"SIZING RULE", BODY[ª]"..."}]:`. The labels
 * (CALLOUT/KIND/EYEBROW/BODY) are always literal; only the separator characters between them are
 * mangled (control codepoints, "ª", etc.), so this matches on the labels and treats anything
 * between them as noise — generic to any project hitting the same leak, not one hardcoded string.
 * Recovers the eyebrow/body text exactly as extracted (no rewording — R2/R3) and reformats it as
 * a blockquote so it's structurally distinct from surrounding prose. Final component choice
 * (e.g. templates/components/tip-callout.html) is a layout decision for /chapter, not ingest —
 * this only repairs the broken character-level artifact.
 */
const CALLOUT_LEAK_RE = /^[^a-z0-9]*callout[^a-z0-9]*kind[^a-z0-9"]*([a-z]+),\s*eyebrow[^a-z0-9"]*"([^"]+)",\s*body[^a-z0-9"]*"([^"]+)"\s*\}\]:?\s*$/i;

function repairLeakedCalloutBlocks(blocks: Block[], sectionTitle: string, page: number, warnings: string[]): Block[] {
  return blocks.map((block) => {
    if (block.type !== "paragraph") return block;
    const match = block.text.match(CALLOUT_LEAK_RE);
    if (!match) return block;
    const [, kind, eyebrow, body] = match;
    warnings.push(
      `Repaired a leaked "${kind.toLowerCase()}" callout artifact in "${sectionTitle}" (page ${page}): its structured props (eyebrow "${eyebrow}", body text) had leaked into the text layer as a mangled stringified object instead of being rendered as a component. Recovered the exact extracted text (no rewording) and reformatted as a blockquote. This is a character-level repair only — render it via the project's tip-callout component (eyebrow "${eyebrow}") when this chapter is laid out.`,
    );
    return { type: "paragraph", text: `> **${eyebrow}**\n>\n> ${body}` };
  });
}

/**
 * Flags C1 control codepoints (U+0080-U+009F) leaking into extracted text. These aren't
 * caught by the U+FFFD/"(cid:" checks in src/qc/checks/no-broken-chars.ts because they're
 * valid Unicode codepoints — but they never belong in body prose, and are the signature of
 * a source-generation artifact (e.g. a template/component's data leaking into the text
 * layer instead of being rendered). Detection only — never rewritten automatically (R2/R3).
 */
function detectControlCharacters(text: string, sectionTitle: string, page: number, warnings: string[]): void {
  const match = text.match(/[-]/);
  if (!match || match.index === undefined) return;
  const start = Math.max(0, match.index - 30);
  const snippet = text.slice(start, match.index + 60).replace(/\s+/g, " ");
  warnings.push(
    `Suspicious control character(s) (U+0080-U+009F range) found in "${sectionTitle}" (page ${page}) — likely a source-generation artifact (e.g. a component's data leaking into text) rather than genuine prose. Context: "…${snippet}…". Left untouched — review before /design-system.`,
  );
}

function renderTable(rows: string[][]): string {
  const columnCount = Math.max(...rows.map((r) => r.length));
  const pad = (row: string[]) => {
    const cells = [...row];
    while (cells.length < columnCount) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };
  const header = pad(rows[0]);
  const separator = `| ${Array(columnCount).fill("---").join(" | ")} |`;
  const body = rows.slice(1).map(pad);
  return [header, separator, ...body].join("\n");
}

function renderMarkdown(
  headingText: string,
  subtitle: string | null,
  bodyLines: ClassifiedLine[],
  sectionTitle: string,
  page: number,
  warnings: string[],
): string {
  const parts: string[] = [`# ${headingText}`];
  if (subtitle) parts.push(`## ${subtitle}`);

  const repaired = repairLeakedCalloutBlocks(buildBlocks(bodyLines), sectionTitle, page, warnings);
  const blocks = dedupeConsecutiveParagraphs(repaired, sectionTitle, page, warnings);
  for (const block of blocks) {
    if (block.type === "paragraph") parts.push(block.text);
    else if (block.type === "list") parts.push(block.items.join("\n"));
    else parts.push(renderTable(block.rows));
  }

  const markdown = `${parts.join("\n\n")}\n`;
  detectControlCharacters(markdown, sectionTitle, page, warnings);
  return markdown;
}

function relativePosixPath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

// --- PDF loading ---------------------------------------------------------

async function extractLines(data: Uint8Array, warnings: string[]): Promise<{ lines: ClassifiedLine[]; pageCount: number }> {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (err) {
    throw new IngestError(`Could not parse source PDF: ${(err as Error).message}`);
  }

  const lines: ClassifiedLine[] = [];
  let strippedFooterCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: RawTextItem[] = (content.items as any[])
        .filter((it) => typeof it.str === "string")
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
          height: it.height || Math.hypot(it.transform[2], it.transform[3]) || 10,
        }));
      const rawLines = groupItemsIntoLines(items, p);
      const pageLines = rawLines.map(classifyLine).filter((l) => l.text.trim() !== "");
      if (isFooterPageNumber(pageLines)) {
        pageLines.pop();
        strippedFooterCount++;
      }
      lines.push(...pageLines);
    } catch (err) {
      warnings.push(`Failed to extract text from page ${p}: ${(err as Error).message}`);
    }
  }
  if (strippedFooterCount > 0) {
    warnings.push(
      `Stripped ${strippedFooterCount} page-footer number line(s) (a lone integer in a smaller font than body text, sitting last/lowest on its page) from the extracted text.`,
    );
  }

  return { lines, pageCount: doc.numPages };
}

/**
 * A page-footer page number: the last (lowest) line on the page, containing nothing but
 * digits, set in a smaller font than the rest of that page's content. Never a real content
 * line — a numbered-list item always carries "." or ")" (LIST_ITEM_RE), and a bare number
 * used in prose never sits alone as the final, smallest-font line on the page.
 */
function isFooterPageNumber(pageLines: ClassifiedLine[]): boolean {
  if (pageLines.length < 2) return false;
  const last = pageLines[pageLines.length - 1];
  if (!/^\d{1,4}$/.test(last.text.trim())) return false;
  const otherFontHeights = pageLines.slice(0, -1).map((l) => l.fontHeight);
  const maxOtherFontHeight = Math.max(...otherFontHeights);
  return last.fontHeight < maxOtherFontHeight;
}

// --- Orchestration -----------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
const validateInventory = ajv.compile(inventorySchema);

function resolveProjectRoot(options: IngestOptions): string {
  const projectsRoot = options.projectsRoot ?? path.resolve(process.cwd(), "workspace/projects");
  return path.join(projectsRoot, options.projectSlug);
}

export async function ingestProject(options: IngestOptions): Promise<IngestResult> {
  const projectRoot = resolveProjectRoot(options);
  const sourcePath = path.join(projectRoot, "source", "original.pdf");

  let buffer: Buffer;
  try {
    buffer = await readFile(sourcePath);
  } catch {
    throw new IngestError(`Source PDF not found at ${sourcePath}. Place the Synthesise AI output there first.`);
  }

  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  const warnings: string[] = [];
  const { lines, pageCount } = await extractLines(new Uint8Array(buffer), warnings);

  const chaptersDir = path.join(projectRoot, "content", "chapters");
  const bonusesDir = path.join(projectRoot, "bonuses", "raw");
  // Ingest is deterministic and re-runnable (R9) — clear stale output first so a shifted
  // chapter numbering (e.g. a merged divider heading changing every filename downstream)
  // can't leave orphaned files from a previous run sitting next to the current ones.
  await rm(chaptersDir, { recursive: true, force: true });
  await rm(bonusesDir, { recursive: true, force: true });
  await mkdir(chaptersDir, { recursive: true });
  await mkdir(bonusesDir, { recursive: true });

  const chapters: InventoryChapter[] = [];
  const bonuses: InventoryBonus[] = [];
  let fallbackUsed = false;

  const sections = segmentDocument(lines, warnings);

  if (sections.length === 0) {
    fallbackUsed = true;
    warnings.push(
      "No CHAPTER/Introduction/Conclusion/BONUS markers detected. The entire source was written as a single fallback file — review the split manually.",
    );
    const markdown = buildBlocks(lines)
      .map((block) => {
        if (block.type === "paragraph") return block.text;
        if (block.type === "list") return block.items.join("\n");
        return renderTable(block.rows);
      })
      .join("\n\n") + "\n";
    const file = path.join(chaptersDir, "00-full-text.md");
    await writeFile(file, markdown, "utf-8");
    chapters.push({
      id: "00-full-text",
      type: "unclassified",
      number: null,
      title: "Full text",
      file: relativePosixPath(projectRoot, file),
      startPage: 1,
      endPage: pageCount,
      wordCount: wordCount(markdown),
    });
  } else {
    let chapterIndex = 0;
    let bonusIndex = 0;
    for (const section of sections) {
      const subtitle = section.titleFromNextLine ? section.title : null;
      const markdown = renderMarkdown(
        section.headingText,
        subtitle,
        section.bodyLines,
        section.title || section.headingText,
        section.startPage,
        warnings,
      );

      if (section.kind === "bonus") {
        const slug = slugify(section.title || section.headingText) || `bonus-${bonusIndex}`;
        const file = path.join(bonusesDir, `${slug}.md`);
        await writeFile(file, markdown, "utf-8");
        bonuses.push({
          id: slug,
          title: section.title || section.headingText,
          file: relativePosixPath(projectRoot, file),
          startPage: section.startPage,
          endPage: section.endPage,
          wordCount: wordCount(markdown),
        });
        bonusIndex++;
      } else {
        const prefix = String(chapterIndex).padStart(2, "0");
        const slugSource = section.title || section.headingText;
        const slug = slugify(slugSource) || section.kind;
        const file = path.join(chaptersDir, `${prefix}-${slug}.md`);
        await writeFile(file, markdown, "utf-8");
        chapters.push({
          id: `${prefix}-${slug}`,
          type: section.kind,
          number: section.number,
          title: section.title || section.headingText,
          file: relativePosixPath(projectRoot, file),
          startPage: section.startPage,
          endPage: section.endPage,
          wordCount: wordCount(markdown),
        });
        chapterIndex++;
      }
    }
  }

  const inventory: Inventory = {
    schemaVersion: 1,
    sourceFile: relativePosixPath(projectRoot, sourcePath),
    sourceSha256,
    extractedAt: new Date().toISOString(),
    pageCount,
    fallbackUsed,
    chapters,
    bonuses,
    warnings,
  };

  if (!validateInventory(inventory)) {
    throw new IngestError(
      `Generated inventory failed schema validation: ${ajv.errorsText(validateInventory.errors)}`,
    );
  }

  const inventoryPath = path.join(projectRoot, "inventory.json");
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf-8");

  return { inventory, projectRoot, inventoryPath };
}
