import type { QcContext, QcCheckResult } from "../types.js";

const MIN_RATIO = 4.5;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA) + 0.05;
  const lB = relativeLuminance(hexB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

/**
 * WCAG 2.x contrast ratio between body text and its background, computed
 * directly from config/resolved.yaml's palette — the same hex values
 * src/design writes into every var(--color-*) that base.css's body text
 * rule consumes (R7), so this is exactly what the reader will see.
 */
export async function checkContrast(ctx: QcContext): Promise<QcCheckResult> {
  const id = "contrast";
  const { text, bg } = ctx.resolvedConfig.palette;

  const ratio = contrastRatio(text, bg);
  const pass = ratio >= MIN_RATIO;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: `Body text ${text} on background ${bg}: contrast ratio ${ratio.toFixed(2)}:1 (threshold >=${MIN_RATIO}:1).`,
    details: { ratio, text, bg },
  };
}
