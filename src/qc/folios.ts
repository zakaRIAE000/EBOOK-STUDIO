import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Reads the folio (printed page number) actually rendered on each PDF page.
 *
 * The folio lives in a GCPM margin box, below the content box, and is the only
 * text down there. Two details are load-bearing:
 *
 *   1. It must be read from the *bottom-most* line of text on the page, not
 *      from "any numeral near the bottom". A table-of-contents row ends in a
 *      page number and can sit low on the page; anchoring to the lowest text
 *      cluster keeps the TOC's own numbers from being mistaken for folios.
 *   2. Its glyphs must be re-joined before being parsed. PDF text extraction
 *      splits a run wherever the producer emitted a new text-showing operator,
 *      so a roman folio comes back as separate fragments — "iv" arrives as
 *      "i" at x=72 and "v" at x=77. Reading fragments individually turns a
 *      perfectly good `iii, iv, v` sequence into a phantom `iii, i, v` skip.
 */

export type FolioKind = "roman" | "arabic";

export interface Folio {
  /** 1-based physical page number in the PDF. */
  page: number;
  /** The folio as printed, e.g. "iv" or "12"; null when the page prints none. */
  text: string | null;
  kind: FolioKind | null;
  /** Numeric value of `text`. */
  value: number | null;
}

const ARABIC_RE = /^\d+$/;
const ROMAN_RE = /^[ivxlcdm]+$/i;

/** How far up the page (as a fraction of its height) to look for the margin box. */
const BOTTOM_BAND = 0.12;
/** Text baselines within this many points are treated as the same line. */
const SAME_LINE_TOLERANCE = 2;

export function romanToInt(value: string): number {
  const digits: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const lower = value.toLowerCase();
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const current = digits[lower[i]];
    const next = digits[lower[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

export async function extractFolios(pdfDoc: PDFDocumentProxy): Promise<Folio[]> {
  const folios: Folio[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const page = await pdfDoc.getPage(pageNumber);
    const pageHeight = page.getViewport({ scale: 1 }).height;
    const textContent = await page.getTextContent();

    const band = (textContent.items as { str?: string; transform?: number[] }[])
      .filter((item) => typeof item.str === "string" && item.str.trim() && Array.isArray(item.transform))
      .map((item) => ({ str: item.str!.trim(), x: item.transform![4], y: item.transform![5] }))
      .filter((item) => item.y < pageHeight * BOTTOM_BAND);

    if (band.length === 0) {
      folios.push({ page: pageNumber, text: null, kind: null, value: null });
      continue;
    }

    // The bottom-most line only — see note (1) above.
    const lowestY = Math.min(...band.map((item) => item.y));
    const text = band
      .filter((item) => Math.abs(item.y - lowestY) <= SAME_LINE_TOLERANCE)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join("")
      .replace(/\s+/g, "");

    if (ARABIC_RE.test(text)) {
      folios.push({ page: pageNumber, text, kind: "arabic", value: parseInt(text, 10) });
    } else if (ROMAN_RE.test(text)) {
      folios.push({ page: pageNumber, text, kind: "roman", value: romanToInt(text) });
    } else {
      // Text down there that is neither — not a folio (or a folio style this
      // pipeline does not produce). Reported as "none" rather than guessed at.
      folios.push({ page: pageNumber, text: null, kind: null, value: null });
    }
  }

  return folios;
}

export interface FolioBreak {
  page: number;
  reason: string;
}

/**
 * Walks the folios in physical page order and reports every place the printed
 * numbering is not what a reader would expect: a skipped number, a repeat, a
 * backwards step, an arabic body that does not restart at 1, or a return to
 * roman after the body has begun. Pages that print no folio (cover, back
 * cover, and any page whose @page rule suppresses it) are skipped over rather
 * than treated as breaks — omitting a folio is a design choice, printing the
 * wrong one is not.
 */
export function findFolioBreaks(folios: Folio[]): FolioBreak[] {
  const breaks: FolioBreak[] = [];
  const printed = folios.filter((f) => f.kind !== null);

  let seenArabic = false;
  for (let i = 0; i < printed.length; i++) {
    const current = printed[i];
    const previous = i > 0 ? printed[i - 1] : null;

    if (current.kind === "arabic") {
      if (!seenArabic) {
        // First arabic folio in the book: the body restart.
        if (current.value !== 1) {
          breaks.push({
            page: current.page,
            reason: `body numbering starts at "${current.text}" instead of 1 (previous folio "${previous?.text ?? "none"}")`,
          });
        }
        seenArabic = true;
        continue;
      }
    } else if (seenArabic) {
      breaks.push({
        page: current.page,
        reason: `roman folio "${current.text}" appears after the body's arabic numbering has begun`,
      });
      continue;
    }

    if (previous === null || previous.kind !== current.kind) continue;

    if (current.value !== previous.value! + 1) {
      const delta = current.value! - previous.value!;
      const detail =
        delta === 0
          ? "repeats it"
          : delta < 0
            ? `goes backwards by ${-delta}`
            : `skips ${delta - 1} number(s)`;
      breaks.push({
        page: current.page,
        reason: `folio "${current.text}" follows "${previous.text}" (page ${previous.page}) — ${detail}`,
      });
    }
  }

  return breaks;
}
