import type { QcContext, QcCheckResult } from "../types.js";

/**
 * U+FFFD (replacement character) means a glyph couldn't be mapped to a
 * codepoint; a literal "(cid:" means a font's ToUnicode CMap was missing and
 * the text layer fell back to printing raw character IDs. Either means the
 * text layer lied about what's on the page.
 */
export async function checkNoBrokenChars(ctx: QcContext): Promise<QcCheckResult> {
  const id = "no-broken-chars";

  const replacementCount = (ctx.fullText.match(/�/g) ?? []).length;
  const cidCount = (ctx.fullText.match(/\(cid:\d+\)/g) ?? []).length;

  if (replacementCount === 0 && cidCount === 0) {
    return {
      id,
      status: "pass",
      pass: true,
      evidence: `Scanned ${ctx.fullText.length} extracted character(s) across ${ctx.pageCount} page(s): zero U+FFFD, zero "(cid:" markers.`,
    };
  }

  return {
    id,
    status: "fail",
    pass: false,
    evidence: `Found ${replacementCount} U+FFFD replacement character(s) and ${cidCount} "(cid:" marker(s) in the extracted text layer.`,
    details: { replacementCount, cidCount },
  };
}
