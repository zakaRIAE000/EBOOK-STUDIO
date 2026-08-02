import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

interface TextItem {
  str?: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Reconstructs readable page text from pdfjs's raw text items. Chromium's
 * PDF export emits one text-show run per glyph for bold/balanced headings
 * (Inter at h1/h2 sizes, text-wrap: balance) rather than one run per word —
 * naively joining items with a space after every one turns "Smoke" into
 * "S mo ke". Instead, a space is only inserted where the x-gap between two
 * same-line items is actually word-sized (mirrors src/ingest's line-cell
 * heuristic, same underlying pdfjs geometry).
 */
export async function extractPageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  let text = "";
  let prevEndX: number | null = null;
  let prevY: number | null = null;

  for (const item of textContent.items as TextItem[]) {
    if (item.str === undefined) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = item.height || Math.abs(item.transform[3]) || 10;

    if (item.str !== "") {
      const sameLine = prevY !== null && Math.abs(prevY - y) < 2;
      if (prevEndX !== null) {
        if (sameLine) {
          if (x - prevEndX > height * 0.15) text += " ";
        } else {
          text += "\n";
        }
      }
      text += item.str;
      prevEndX = x + item.width;
      prevY = y;
    }

    if (item.hasEOL) {
      text += "\n";
      prevEndX = null;
      prevY = null;
    }
  }

  return text;
}
