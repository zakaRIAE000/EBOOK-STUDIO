import type { QcContext, QcCheckResult } from "../types.js";

function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** Every chapter inventory.json says exists must actually have made it into the rendered PDF. */
export async function checkStructure(ctx: QcContext): Promise<QcCheckResult> {
  const id = "structure";

  if (ctx.inventory.chapters.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "inventory.json has no chapters to check." };
  }

  const normalizedFullText = normalize(ctx.fullText);
  const missing = ctx.inventory.chapters.filter((ch) => !normalizedFullText.includes(normalize(ch.title)));

  const pass = missing.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `All ${ctx.inventory.chapters.length} chapter(s) from inventory.json have their title present in the rendered PDF.`
      : `${missing.length} chapter(s) missing from the rendered PDF: ${missing.map((c) => c.title).join(", ")}.`,
    details: { missing: missing.map((c) => c.id) },
  };
}
