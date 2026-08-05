import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodePng, inkCoverageRatio, UnsupportedPngError } from "../png.js";
import { inlineLocalFontUrls, openPaginatedDocument } from "../../render/index.js";
import type { QcContext, QcCheckResult } from "../types.js";

const MIN_RATIO = 0.02;
const MAX_RATIO = 0.62;

interface FrontMatterDetection {
  /** Number of leading pages classified as front matter (0 = none detected / not determinable). */
  frontMatterPageCount: number;
  reason: string;
}

/**
 * Front matter (title page, copyright, TOC, bonus teaser) is intentionally
 * sparse by design and shouldn't be held to the same ink floor as body
 * pages. Detecting it by searching the PDF text layer for the first
 * chapter's title is tempting but unsound: the TOC page itself *contains*
 * that exact title text as a listed entry (e.g. "Introduction    5"), so a
 * plain substring search flags the TOC — the sparsest page of all — as the
 * start of the chapter it's supposed to be exempting.
 * Instead this re-runs the same Paged.js pagination pass src/render uses
 * (openPaginatedDocument) and reads Paged.js's own `pagedjs_chapter-open_page`
 * class, which it applies only to pages laid out under base.css's
 * `@page chapter-open` rule — i.e. exactly the pages chapter.html's
 * `.chapter-open` sections produce, and nothing else. The first page
 * carrying that class is unambiguously where body content starts; every
 * page before it is front matter.
 */
async function detectFrontMatterPageCount(ctx: QcContext): Promise<FrontMatterDetection> {
  if (!ctx.bookHtml) {
    return { frontMatterPageCount: 0, reason: "no html/<slug>-book.html found — front-matter exemption unavailable, full 2%-62% range enforced on every page" };
  }

  const baseCssPath = path.join(ctx.repoRoot, "templates", "base.css");
  const baseCssRaw = await readFile(baseCssPath, "utf-8");
  const baseCss = await inlineLocalFontUrls(baseCssRaw, path.dirname(baseCssPath));

  const { browser, page } = await openPaginatedDocument({
    bodyHtml: ctx.bookHtml,
    css: [baseCss, ctx.tokensCss],
    title: ctx.resolvedConfig.project.title,
    // Same base dir the assembler rendered with, so this re-pagination produces
    // the same page count and the same page classes it did there.
    baseDir: ctx.projectRoot,
  });

  try {
    const pageClasses = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".pagedjs_page")).map((el) => Array.from(el.classList)),
    );

    if (pageClasses.length !== ctx.previewPaths.length) {
      return {
        frontMatterPageCount: 0,
        reason: `re-pagination produced ${pageClasses.length} page(s) but ${ctx.previewPaths.length} preview(s) exist (stale previews?) — full 2%-62% range enforced on every page`,
      };
    }

    const firstBodyIndex = pageClasses.findIndex((classes) => classes.includes("pagedjs_chapter-open_page"));
    if (firstBodyIndex === -1) {
      return { frontMatterPageCount: 0, reason: "no page/@page chapter-open (.chapter-open section) found — full 2%-62% range enforced on every page" };
    }

    return {
      frontMatterPageCount: firstBodyIndex,
      reason: `page(s) 1-${firstBodyIndex} precede the first .chapter-open page (Paged.js class pagedjs_chapter-open_page found at page ${firstBodyIndex + 1}) — exempted as front matter`,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Every body page should carry a plausible amount of ink: too little (<2%)
 * means a page that's effectively blank (a render failure, a component that
 * silently produced nothing); too much (>62%) means something is bleeding
 * over the page (an oversized background, an image that swallowed the
 * layout). Measured from previews/page-*.png, the same PNGs a human gate
 * reviews (R9/R6 — one artifact, one truth). Front matter (see
 * detectFrontMatterPageCount) is measured and reported but exempted from
 * the range — it's sparse by design, not by defect.
 */
export async function checkInkCoverage(ctx: QcContext): Promise<QcCheckResult> {
  const id = "ink-coverage";

  if (ctx.previewPaths.length === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: `No preview PNGs found in ${path.relative(ctx.projectRoot, ctx.previewsDir)}/ — run studio:prototype/build with --previews first.`,
    };
  }

  const { frontMatterPageCount, reason } = await detectFrontMatterPageCount(ctx);

  const perPage: { file: string; ratio: number; exempt: boolean }[] = [];
  for (let i = 0; i < ctx.previewPaths.length; i++) {
    const previewPath = ctx.previewPaths[i];
    let ratio: number;
    try {
      const buffer = await readFile(previewPath);
      ratio = inkCoverageRatio(decodePng(buffer));
    } catch (err) {
      if (err instanceof UnsupportedPngError) {
        return {
          id,
          status: "skipped",
          pass: false,
          evidence: `${path.basename(previewPath)} could not be decoded: ${err.message}`,
        };
      }
      throw err;
    }
    perPage.push({ file: path.basename(previewPath), ratio, exempt: i < frontMatterPageCount });
  }

  const outOfBand = perPage.filter((p) => !p.exempt && (p.ratio < MIN_RATIO || p.ratio > MAX_RATIO));
  const pass = outOfBand.length === 0;
  const exemptPages = perPage.filter((p) => p.exempt);
  const checkedPages = perPage.filter((p) => !p.exempt);

  const exemptNote = exemptPages.length > 0
    ? ` Front matter exempted from the range (${reason}): ${exemptPages.map((p) => `${p.file} (${(p.ratio * 100).toFixed(1)}%)`).join(", ")}.`
    : ` (${reason}.)`;

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: (pass
      ? `All ${checkedPages.length} body page(s) fall within ${(MIN_RATIO * 100).toFixed(0)}%-${(MAX_RATIO * 100).toFixed(0)}% ink coverage${checkedPages.length > 0 ? ` (range ${(Math.min(...checkedPages.map((p) => p.ratio)) * 100).toFixed(1)}%-${(Math.max(...checkedPages.map((p) => p.ratio)) * 100).toFixed(1)}%)` : ""}.`
      : `${outOfBand.length}/${checkedPages.length} body page(s) outside ${(MIN_RATIO * 100).toFixed(0)}%-${(MAX_RATIO * 100).toFixed(0)}%: ${outOfBand.map((p) => `${p.file} (${(p.ratio * 100).toFixed(1)}%)`).join(", ")}.`
    ) + exemptNote,
    details: { perPage, frontMatterPageCount },
  };
}
