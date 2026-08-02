import type { QcContext, QcCheckResult } from "../types.js";

interface PdfFontObj {
  missingFile?: boolean;
  systemFontInfo?: unknown;
  name?: string;
}

/**
 * Every glyph shown must come from a font Chromium actually embedded, not a
 * silent fallback to a system font (which would break R10 — OFL fonts only —
 * and make the PDF non-portable). pdfjs marks a substituted font with a
 * populated `systemFontInfo`; `missingFile` covers the same failure from the
 * other side (font dict had no embedded program at all).
 * getOperatorList() must run before commonObjs is populated with font
 * objects — getTextContent() alone does not load them (verified empirically).
 */
export async function checkFontsEmbedded(ctx: QcContext): Promise<QcCheckResult> {
  const id = "fonts-embedded";
  const unembedded = new Set<string>();
  const allFontNames = new Set<string>();

  for (let i = 1; i <= ctx.pageCount; i++) {
    const page = await ctx.pdfDoc.getPage(i);
    await page.getOperatorList();
    const textContent = await page.getTextContent();
    const commonObjs = (page as unknown as { commonObjs: { has(k: string): boolean; get(k: string): PdfFontObj } }).commonObjs;
    const fontNames = new Set(
      (textContent.items as Array<{ str?: string; fontName?: string }>)
        .filter((item) => item.str !== undefined && item.fontName)
        .map((item) => item.fontName as string),
    );
    for (const fontName of fontNames) {
      if (!commonObjs.has(fontName)) continue;
      const font = commonObjs.get(fontName);
      const label = font.name ?? fontName;
      allFontNames.add(label);
      if (font.missingFile || font.systemFontInfo) {
        unembedded.add(`${label} (page ${i})`);
      }
    }
  }

  if (allFontNames.size === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "No text-bearing fonts were found in the PDF's operator list — nothing to verify.",
    };
  }

  if (unembedded.size > 0) {
    return {
      id,
      status: "fail",
      pass: false,
      evidence: `${unembedded.size} font usage(s) fell back to a non-embedded system font: ${[...unembedded].slice(0, 5).join(", ")}${unembedded.size > 5 ? ", …" : ""}.`,
      details: { unembedded: [...unembedded] },
    };
  }

  return {
    id,
    status: "pass",
    pass: true,
    evidence: `All ${allFontNames.size} font(s) used across ${ctx.pageCount} page(s) are embedded (checked via pdfjs commonObjs missingFile/systemFontInfo): ${[...allFontNames].join(", ")}.`,
    details: { fonts: [...allFontNames] },
  };
}
