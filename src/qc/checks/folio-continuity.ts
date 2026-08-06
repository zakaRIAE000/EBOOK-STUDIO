import { extractFolios, findFolioBreaks, type Folio } from "../folios.js";
import type { QcContext, QcCheckResult } from "../types.js";

function describeRun(folios: Folio[], kind: "roman" | "arabic"): string | null {
  const run = folios.filter((f) => f.kind === kind);
  if (run.length === 0) return null;
  return `${kind} ${run[0].text}-${run[run.length - 1].text} on ${run.length} page(s)`;
}

/**
 * Walks the folios actually printed in the PDF and fails on any break in the
 * sequence.
 *
 * Nothing else in the suite reads them. structure and outline-toc check that
 * chapters exist and that TOC links resolve; text-coverage checks the words.
 * A page number is generated content produced by a CSS counter, so it is
 * exactly the kind of thing that can be silently wrong while every other gate
 * is satisfied — and was: the gold book shipped a GO with its body numbered
 * 1, 7, 8, 9, because Paged.js scopes a content `counter-reset: page` to the
 * single page it lands on and drops that page's increment. Five numbers never
 * appeared and nothing noticed.
 *
 * The check is deliberately made against the rendered PDF rather than the
 * paginated DOM: the folio a reader sees is the one the print produced, and
 * the DOM's margin boxes hold it as generated content that is not readable
 * from the element tree at all.
 */
export async function checkFolioContinuity(ctx: QcContext): Promise<QcCheckResult> {
  const id = "folio-continuity";

  const folios = await extractFolios(ctx.pdfDoc);
  const printed = folios.filter((f) => f.kind !== null);

  if (printed.length === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: `No page in ${ctx.outputPdfPath} prints a folio — nothing to check for continuity.`,
    };
  }

  const breaks = findFolioBreaks(folios);
  const runs = [describeRun(folios, "roman"), describeRun(folios, "arabic")].filter(Boolean).join(", ");
  const unnumbered = folios.filter((f) => f.kind === null).map((f) => f.page);
  const unnumberedNote = unnumbered.length > 0 ? ` ${unnumbered.length} page(s) print no folio by design (${unnumbered.join(", ")}).` : "";

  const pass = breaks.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `All ${printed.length} printed folio(s) run in unbroken sequence: ${runs}.${unnumberedNote}`
      : `${breaks.length} break(s) in the printed folio sequence (${runs}): ${breaks.map((b) => `page ${b.page}: ${b.reason}`).join("; ")}.${unnumberedNote}`,
    details: {
      breaks,
      folios: folios.map((f) => ({ page: f.page, folio: f.text })),
    },
  };
}
