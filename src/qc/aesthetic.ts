import type { AestheticScore, QcCheckResult, QcContext } from "./types.js";

/** Skipped checks (e.g. "no images referenced") are excluded rather than counted as failures — an absent input isn't a quality defect. */
function passRatio(results: QcCheckResult[], ids: string[]): number {
  const relevant = results.filter((r) => ids.includes(r.id) && r.status !== "skipped");
  if (relevant.length === 0) return 1;
  const passed = relevant.filter((r) => r.status === "pass").length;
  return passed / relevant.length;
}

function byId(results: QcCheckResult[], id: string): QcCheckResult | undefined {
  return results.find((r) => r.id === id);
}

/**
 * A /100 proxy score, gates nothing (non-blocking — R8 gates only run on
 * the pass/fail checks above). Every sub-score is derived from a real,
 * already-measured signal (never an invented number); nicheFit is the one
 * dimension this pipeline has no deterministic signal for, so it's flagged
 * explicitly rather than faked.
 */
export function computeAestheticScore(ctx: QcContext, results: QcCheckResult[]): AestheticScore {
  const notes: string[] = [];

  const structureResult = byId(results, "structure");
  const textCoverageResult = byId(results, "text-coverage");
  const noBonusResult = byId(results, "no-bonus-in-body");
  const textCoverage = (textCoverageResult?.details as { coverage?: number } | undefined)?.coverage ?? (textCoverageResult?.status === "pass" ? 1 : 0);
  const content = 25 * ((structureResult?.status === "pass" ? 1 : 0) + textCoverage + (noBonusResult?.status === "pass" ? 1 : 0)) / 3;

  const typography = 20 * passRatio(results, ["fonts-embedded", "min-font-size", "contrast"]);

  const layout = 20 * passRatio(results, ["ink-coverage", "no-overflow", "outline-toc"]);

  const consistency = 15 * passRatio(results, ["metadata", "assets-exist"]);

  const blockingIds = results.map((r) => r.id);
  const technical = 10 * passRatio(results, blockingIds);

  const nicheFit = 7; // neutral default — see note below; no deterministic signal exists for this dimension yet.
  notes.push(
    "nicheFit (7/10 default) has no deterministic signal in this pipeline yet — it reflects whether the book's tone/visuals actually fit its niche, which is a human judgment call, not something QC measures. Review by eye.",
  );

  if (textCoverageResult?.status === "skipped") notes.push("content score partially unmeasured: text-coverage check was skipped.");
  if (byId(results, "ink-coverage")?.status === "skipped") notes.push("layout score partially unmeasured: ink-coverage check was skipped (no previews found).");
  if (byId(results, "assets-exist")?.status === "skipped" && byId(results, "image-dpi")?.status === "skipped") {
    notes.push("consistency score computed with no images referenced in this project — assets-exist/image-dpi were skipped, not counted against it.");
  }

  const breakdown = {
    content: Math.round(content * 10) / 10,
    typography: Math.round(typography * 10) / 10,
    layout: Math.round(layout * 10) / 10,
    consistency: Math.round(consistency * 10) / 10,
    technical: Math.round(technical * 10) / 10,
    nicheFit,
  };
  const total = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0) * 10) / 10;

  return { total, max: 100, breakdown, notes };
}
