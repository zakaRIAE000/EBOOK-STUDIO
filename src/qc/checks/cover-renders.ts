import { readFile } from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { decodePng, inkCoverageRatio, texturedCellRatio, UnsupportedPngError } from "../png.js";
import type { QcContext, QcCheckResult } from "../types.js";

/**
 * The cover is always the first section in canonical assembly order, so it must
 * land on PDF page 1. Discovering the cover's page index instead would quietly
 * tolerate the other half of the defect this gate exists for — a blank leaf
 * pushed in front of the cover still means page 1 of the delivered file is not
 * the cover.
 */
const COVER_PAGE_NUMBER = 1;

/**
 * base.css renders the cover as `width/height: 100%; object-fit: cover`, so a
 * cover that loaded fills its page edge to edge and textures every cell of the
 * grid. Measured on this pipeline's own output: a correctly rendered cover
 * scores 100%, a cover broken by an unresolvable src scores 10.9%, and the
 * densest ordinary page in the book (the back cover, a solid brand panel with
 * heavy type) scores 59.4%. The floor sits well clear of both sides.
 */
const MIN_TEXTURED_CELLS = 0.85;

/**
 * A broken <img> still paints an image XObject — Chromium's broken-image icon
 * is itself a bitmap. So the presence of an image is a necessary condition
 * only; MIN_TEXTURED_CELLS is what establishes that the image is the cover
 * rather than a 16px placeholder icon.
 */
const IMAGE_PAINT_OPS = new Set<number>([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
]);

const COVER_SECTION_RE = /<section[^>]*\bclass="[^"]*\bcover-page\b/;

/**
 * Proves the cover art actually reached the reader, rather than merely existing
 * on disk.
 *
 * assets-exist already confirms every referenced file resolves, and image-dpi
 * confirms the file is big enough — but both stop at the filesystem, and
 * neither could see the failure they were meant to prevent. The assembler
 * emitted a project-root-relative `<img src>` while the renderer loaded the
 * document with no base URL, so Chromium resolved the cover against
 * about:blank, requested nothing, raised nothing, and printed the alt text.
 * All fourteen gates passed on a book whose first page was a broken-image icon.
 *
 * This gate therefore measures the rendered result on both sides of the render:
 *   1. the PDF's page 1 must paint at least one image XObject;
 *   2. that page's preview PNG must be textured edge to edge, which is what
 *      separates the cover from the broken-image icon that also satisfies (1),
 *      and independently catches a cover displaced by a blank leading page.
 * Both are reported whatever the verdict, because the pair of numbers is what
 * tells a human which half broke.
 */
export async function checkCoverRenders(ctx: QcContext): Promise<QcCheckResult> {
  const id = "cover-renders";

  if (!ctx.bookHtml) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "No assembled html/<slug>-book.html found for this project — no composed cover to verify.",
    };
  }

  if (!COVER_SECTION_RE.test(ctx.bookHtml)) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence:
        'html/<slug>-book.html composes no <section class="cover-page"> — this book was assembled without a cover (studio:build reports it under skipped sections). Nothing to verify.',
    };
  }

  if (ctx.pageCount < COVER_PAGE_NUMBER) {
    return {
      id,
      status: "fail",
      pass: false,
      evidence: `The PDF has ${ctx.pageCount} page(s); there is no page ${COVER_PAGE_NUMBER} to carry the cover.`,
    };
  }

  // 1. Does page 1 of the actual PDF paint an image at all?
  const pdfPage = await ctx.pdfDoc.getPage(COVER_PAGE_NUMBER);
  const operatorList = await pdfPage.getOperatorList();
  const imageOps = (operatorList.fnArray as number[]).filter((fn) => IMAGE_PAINT_OPS.has(fn)).length;

  // 2. Does that page read as full-bleed artwork?
  let textured: number | null = null;
  let inkPercent: number | null = null;
  let previewNote: string;
  const previewPath = ctx.previewPaths[COVER_PAGE_NUMBER - 1];

  if (!previewPath) {
    previewNote = `no preview PNG for page ${COVER_PAGE_NUMBER} in ${path.relative(ctx.projectRoot, ctx.previewsDir)}/ — full-bleed coverage not measured`;
  } else {
    try {
      const png = decodePng(await readFile(previewPath));
      textured = texturedCellRatio(png);
      inkPercent = inkCoverageRatio(png) * 100;
      previewNote = `${path.basename(previewPath)} is textured across ${(textured * 100).toFixed(1)}% of the page (floor ${(MIN_TEXTURED_CELLS * 100).toFixed(0)}%), ${inkPercent.toFixed(2)}% ink`;
    } catch (err) {
      if (!(err instanceof UnsupportedPngError)) throw err;
      previewNote = `${path.basename(previewPath)} could not be decoded (${err.message}) — full-bleed coverage not measured`;
    }
  }

  const embedded = imageOps > 0;
  // An unmeasurable preview is not evidence of failure; the PDF-side condition
  // still has to hold on its own (R8 — absent proof is never a pass, but it is
  // also not a fabricated failure).
  const fullBleed = textured === null || textured >= MIN_TEXTURED_CELLS;
  const pass = embedded && fullBleed;

  const embedNote = embedded
    ? `PDF page ${COVER_PAGE_NUMBER} paints ${imageOps} image XObject(s)`
    : `PDF page ${COVER_PAGE_NUMBER} paints no image XObject at all — no cover art reached the output`;

  const diagnosis = pass
    ? ""
    : embedded && !fullBleed
      ? " — an image is present but does not cover the page: the cover art failed to load (a src that does not resolve at render time renders as a broken-image icon plus alt text), or a blank page precedes the cover."
      : " — the cover art did not render into the output.";

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: `${embedNote}; ${previewNote}.${diagnosis}`,
    details: {
      coverPage: COVER_PAGE_NUMBER,
      imageOps,
      texturedCellRatio: textured,
      inkPercent,
      minTexturedCells: MIN_TEXTURED_CELLS,
    },
  };
}
