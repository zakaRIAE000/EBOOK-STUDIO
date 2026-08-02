import { readFile } from "node:fs/promises";
import path from "node:path";
import { readImageSize } from "../image-size.js";
import type { QcContext, QcCheckResult } from "../types.js";

const MIN_DPI = 150;
const RASTER_SRC_RE = /src="([^"]+\.(?:png|jpe?g))"/gi;

function parseInches(value: string): number | null {
  const match = value.match(/^([\d.]+)in$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Raster images (covers, Higgsfield ambient illustrations — SVG diagrams are
 * exempt, R4) must hold >=150dpi at their rendered size. Rendered width is
 * approximated as the printable content column (page width minus outer +
 * inner margins) since figure images render at width:100% of that column
 * (base.css `figure.figure img { width: 100% }`) — the one place a raster
 * image's size is actually determined in this pipeline.
 */
export async function checkImageDpi(ctx: QcContext): Promise<QcCheckResult> {
  const id = "image-dpi";

  if (!ctx.bookHtml) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "No assembled html/<slug>-book.html found for this project — nothing to scan for raster images.",
    };
  }

  const refs = new Set<string>();
  for (const match of ctx.bookHtml.matchAll(RASTER_SRC_RE)) refs.add(match[1]);

  if (refs.size === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "html/<slug>-book.html references no raster (PNG/JPEG) images — SVG-only diagrams are exempt (R4).",
    };
  }

  const pageWidthIn = parseInches(ctx.resolvedConfig.format.pageWidth);
  const marginOuterIn = parseInches(ctx.resolvedConfig.format.marginOuter);
  const marginInnerIn = parseInches(ctx.resolvedConfig.format.marginInner);
  if (pageWidthIn === null || marginOuterIn === null || marginInnerIn === null) {
    return { id, status: "skipped", pass: false, evidence: "config/resolved.yaml format.* values are not parseable inch lengths." };
  }
  const contentWidthIn = pageWidthIn - marginOuterIn - marginInnerIn;

  const results: { file: string; dpi: number }[] = [];
  const unreadable: string[] = [];
  for (const ref of refs) {
    try {
      const buffer = await readFile(path.join(ctx.projectRoot, ref));
      const size = readImageSize(buffer, ref);
      if (!size) { unreadable.push(ref); continue; }
      results.push({ file: ref, dpi: size.width / contentWidthIn });
    } catch {
      unreadable.push(ref);
    }
  }

  if (results.length === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: `Found ${refs.size} raster image reference(s) but none could be read/decoded: ${unreadable.join(", ")}.`,
    };
  }

  const tooLow = results.filter((r) => r.dpi < MIN_DPI);
  const pass = tooLow.length === 0 && unreadable.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `All ${results.length} raster image(s) are >=${MIN_DPI}dpi at their rendered width (${contentWidthIn.toFixed(2)}in content column).`
      : `${tooLow.length} image(s) below ${MIN_DPI}dpi at ${contentWidthIn.toFixed(2)}in rendered width: ${tooLow.map((r) => `${r.file} (${r.dpi.toFixed(0)}dpi)`).join(", ")}.${unreadable.length ? ` ${unreadable.length} unreadable: ${unreadable.join(", ")}.` : ""}`,
    details: { results, unreadable, contentWidthIn },
  };
}
