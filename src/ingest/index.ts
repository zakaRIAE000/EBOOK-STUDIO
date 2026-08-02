import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
 * (same paragraph); wider gaps carry paragraph margin and mark a new block. Tuned against
 * the fixture's 1.5 line-height (18pt gap at 12pt type must merge).
 */
const PARAGRAPH_LINE_GAP_RATIO = 1.7;
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

  return sections;
}

// --- Block reconstruction (paragraphs / lists / tables) ---------------------

type Block =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][] };

function buildBlocks(lines: ClassifiedLine[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.isListItem) {
      const items: string[] = [];
      while (i < lines.length && lines[i].isListItem) {
        items.push(lines[i].text.trim());
        i++;
      }
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
      if (candidate.isListItem || candidate.isTableRow || candidate.page !== prev.page) break;
      const avgFontHeight = (candidate.fontHeight + prev.fontHeight) / 2;
      const gap = prev.y - candidate.y;
      if (gap > avgFontHeight * PARAGRAPH_LINE_GAP_RATIO) break;
      text += ` ${candidate.text.trim()}`;
      prev = candidate;
      i++;
    }
    blocks.push({ type: "paragraph", text });
  }
  return blocks;
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

function renderMarkdown(headingText: string, subtitle: string | null, bodyLines: ClassifiedLine[]): string {
  const parts: string[] = [`# ${headingText}`];
  if (subtitle) parts.push(`## ${subtitle}`);

  for (const block of buildBlocks(bodyLines)) {
    if (block.type === "paragraph") parts.push(block.text);
    else if (block.type === "list") parts.push(block.items.join("\n"));
    else parts.push(renderTable(block.rows));
  }

  return `${parts.join("\n\n")}\n`;
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
      lines.push(...rawLines.map(classifyLine).filter((l) => l.text.trim() !== ""));
    } catch (err) {
      warnings.push(`Failed to extract text from page ${p}: ${(err as Error).message}`);
    }
  }

  return { lines, pageCount: doc.numPages };
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
      const markdown = renderMarkdown(section.headingText, subtitle, section.bodyLines);

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
