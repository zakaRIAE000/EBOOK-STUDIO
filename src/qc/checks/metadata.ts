import type { QcContext, QcCheckResult } from "../types.js";

interface PdfInfo {
  Title?: string;
  Language?: string;
}

/**
 * Checks Title and Lang against the PDF's /Info dictionary (populated by
 * Chromium from <title> and <html lang> when page.pdf() is called with
 * tagged: true — see src/render). Chromium's print-to-PDF has no author
 * field in its /Info dict or CDP params (verified: no amount of <meta
 * name="author"> propagates one), so authorship is checked the only place
 * it's actually provable — the author's name appearing in the rendered
 * text a reader sees (title page / copyright page), not a metadata field
 * this pipeline has no way to set.
 */
export async function checkMetadata(ctx: QcContext): Promise<QcCheckResult> {
  const id = "metadata";

  const { info } = await ctx.pdfDoc.getMetadata();
  const pdfInfo = info as PdfInfo;

  const expectedTitle = ctx.resolvedConfig.project.title;
  const titleOk = pdfInfo.Title === expectedTitle;
  const langOk = pdfInfo.Language === "en-US";
  const authorOk = ctx.fullText.includes(ctx.resolvedConfig.project.author);

  const pass = titleOk && langOk && authorOk;
  const parts = [
    `Title ${titleOk ? "matches" : "does NOT match"} ("${pdfInfo.Title ?? "(none)"}" vs expected "${expectedTitle}")`,
    `Lang ${langOk ? "is" : "is NOT"} en-US (found "${pdfInfo.Language ?? "(none)"}")`,
    `author "${ctx.resolvedConfig.project.author}" ${authorOk ? "found" : "NOT found"} in rendered text`,
  ];

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: parts.join("; ") + ".",
    details: { title: pdfInfo.Title, lang: pdfInfo.Language, expectedTitle, author: ctx.resolvedConfig.project.author, authorOk },
  };
}
