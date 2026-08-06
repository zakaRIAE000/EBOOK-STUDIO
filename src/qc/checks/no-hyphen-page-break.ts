import type { QcContext, QcCheckResult } from "../types.js";

/**
 * Chromium renders an automatic (or soft-hyphen) break as U+2010 HYPHEN, and an
 * authored hyphen as the ordinary U+002D it was written with. That difference
 * is what lets this check separate "the renderer split this word" from "the
 * author wrote a hyphen here", verified by rendering the same book both ways.
 */
const RENDERER_HYPHENS = ["‐", "‑", "­"];
const AUTHORED_HYPHEN = "-";

/** Fractions of page height that bound the content box, excluding the folio and running-header margin boxes. */
const CONTENT_BAND_BOTTOM = 0.12;
const CONTENT_BAND_TOP = 0.93;
/** Text baselines within this many points are treated as the same line. */
const SAME_LINE_TOLERANCE = 2;

interface PageEnding {
  page: number;
  line: string;
  hyphen: string;
}

/**
 * Fails when a page's last line ends on a renderer-inserted hyphen, i.e. a word
 * split across the page boundary.
 *
 * This is not a typographic preference — it is the signature of silent text
 * loss. When Chromium hyphenates the last word of a page, Paged.js's fragmenter
 * and the painted layout disagree about where that page ends: Paged.js leaves
 * the whole line in the page's DOM fragment and begins the next fragment after
 * it, while the browser paints only as far as the hyphen and pushes the rest
 * into the off-page overflow column, where it is clipped away. The words stay
 * in the DOM, so no check that walks the element tree can see the loss, and
 * no-overflow measures nothing wrong because nothing overflows its box.
 *
 * That is exactly how gold shipped a GO with a line missing from the middle of
 * its legal disclaimer — the sentence read "…have inherent limi-" and continued
 * "lect actual trading conditions", six words later. Six other page boundaries
 * in the same build each swallowed a word. base.css now sets `hyphens: manual`;
 * this gate is what keeps it that way, for any project.
 *
 * A page ending on an *authored* hyphen (U+002D, e.g. "funded-account") is
 * reported but does not fail: the text is the author's, no CSS setting
 * prevents a break there, and the fix would be per-phrase markup rather than a
 * project-wide switch. It is surfaced so a human can judge it.
 */
export async function checkNoHyphenPageBreak(ctx: QcContext): Promise<QcCheckResult> {
  const id = "no-hyphen-page-break";

  if (ctx.pageCount < 2) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: `${ctx.outputPdfPath} has ${ctx.pageCount} page(s) — no page boundary to inspect.`,
    };
  }

  const rendererSplits: PageEnding[] = [];
  const authoredSplits: PageEnding[] = [];
  let inspected = 0;

  // The last page cannot split a word onto a following page.
  for (let pageNumber = 1; pageNumber < ctx.pageCount; pageNumber++) {
    const page = await ctx.pdfDoc.getPage(pageNumber);
    const pageHeight = page.getViewport({ scale: 1 }).height;
    const textContent = await page.getTextContent();

    const body = (textContent.items as { str?: string; transform?: number[] }[])
      .filter((item) => typeof item.str === "string" && item.str.trim() && Array.isArray(item.transform))
      .map((item) => ({ str: item.str!.trim(), x: item.transform![4], y: item.transform![5] }))
      .filter((item) => item.y > pageHeight * CONTENT_BAND_BOTTOM && item.y < pageHeight * CONTENT_BAND_TOP);

    if (body.length === 0) continue;
    inspected++;

    const lowestY = Math.min(...body.map((item) => item.y));
    const line = body
      .filter((item) => Math.abs(item.y - lowestY) <= SAME_LINE_TOLERANCE)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join("");

    const lastChar = line.slice(-1);
    const ending: PageEnding = { page: pageNumber, line: line.slice(-52), hyphen: lastChar };
    if (RENDERER_HYPHENS.includes(lastChar)) rendererSplits.push(ending);
    else if (lastChar === AUTHORED_HYPHEN) authoredSplits.push(ending);
  }

  const authoredNote = authoredSplits.length
    ? ` ${authoredSplits.length} page(s) end on an authored hyphen (not a failure, review by eye): ${authoredSplits.map((e) => `p${e.page} "…${e.line}"`).join(", ")}.`
    : "";

  const pass = rendererSplits.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `No page boundary splits a word on a renderer-inserted hyphen across ${inspected} inspected page(s).${authoredNote}`
      : `${rendererSplits.length} page(s) end mid-word on a renderer-inserted hyphen, which clips the remainder out of the PDF: ${rendererSplits
          .map((e) => `p${e.page} "…${e.line}"`)
          .join(", ")}. Set \`hyphens: manual\` (templates/base.css) rather than accepting the loss.${authoredNote}`,
    details: { rendererSplits, authoredSplits, inspectedPages: inspected },
  };
}
