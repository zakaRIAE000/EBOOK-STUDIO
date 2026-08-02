import type { QcContext, QcCheckResult } from "../types.js";

const MAX_BYTES = 15 * 1024 * 1024;

export async function checkFileSize(ctx: QcContext): Promise<QcCheckResult> {
  const id = "file-size";
  const bytes = ctx.pdfBytes.length;
  const pass = bytes < MAX_BYTES;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: `${ctx.outputPdfPath} is ${(bytes / (1024 * 1024)).toFixed(2)}MB (limit <${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB).`,
    details: { bytes },
  };
}
