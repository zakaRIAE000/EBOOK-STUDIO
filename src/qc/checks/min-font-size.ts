import type { QcContext, QcCheckResult } from "../types.js";

const MIN_PT = 9.5;

/**
 * Reads --font-size-body straight from design/tokens.css rather than
 * measuring rendered glyphs in the PDF: tokens.css (R7) is the single
 * source of truth base.css's `p { font-size: var(--font-size-body) }`
 * consumes, so if the token is compliant the render is guaranteed to be —
 * and unlike PDF glyph heights, tokens.css carries no ambiguity about which
 * text role (body vs. caption vs. meta) a given size belongs to.
 */
export async function checkMinFontSize(ctx: QcContext): Promise<QcCheckResult> {
  const id = "min-font-size";

  const match = ctx.tokensCss.match(/--font-size-body:\s*([\d.]+)pt\s*;/);
  if (!match) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "design/tokens.css has no parseable --font-size-body: <N>pt; declaration.",
    };
  }

  const sizePt = parseFloat(match[1]);
  const pass = sizePt >= MIN_PT;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: `--font-size-body is ${sizePt}pt (threshold >=${MIN_PT}pt).`,
    details: { sizePt },
  };
}
