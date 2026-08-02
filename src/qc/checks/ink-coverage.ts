import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodePng, inkCoverageRatio, UnsupportedPngError } from "../png.js";
import type { QcContext, QcCheckResult } from "../types.js";

const MIN_RATIO = 0.02;
const MAX_RATIO = 0.62;

/**
 * Every page should carry a plausible amount of ink: too little (<2%) means
 * a page that's effectively blank (a render failure, a component that
 * silently produced nothing); too much (>62%) means something is bleeding
 * over the page (an oversized background, an image that swallowed the
 * layout). Measured from previews/page-*.png, the same PNGs a human gate
 * reviews (R9/R6 — one artifact, one truth).
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

  const perPage: { file: string; ratio: number }[] = [];
  for (const previewPath of ctx.previewPaths) {
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
    perPage.push({ file: path.basename(previewPath), ratio });
  }

  const outOfBand = perPage.filter((p) => p.ratio < MIN_RATIO || p.ratio > MAX_RATIO);
  const pass = outOfBand.length === 0;

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `All ${perPage.length} preview page(s) fall within ${(MIN_RATIO * 100).toFixed(0)}%-${(MAX_RATIO * 100).toFixed(0)}% ink coverage (range ${(Math.min(...perPage.map((p) => p.ratio)) * 100).toFixed(1)}%-${(Math.max(...perPage.map((p) => p.ratio)) * 100).toFixed(1)}%).`
      : `${outOfBand.length}/${perPage.length} page(s) outside ${(MIN_RATIO * 100).toFixed(0)}%-${(MAX_RATIO * 100).toFixed(0)}%: ${outOfBand.map((p) => `${p.file} (${(p.ratio * 100).toFixed(1)}%)`).join(", ")}.`,
    details: { perPage },
  };
}
