import { readFile } from "node:fs/promises";
import path from "node:path";
import type { QcContext, QcCheckResult } from "../types.js";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Bonus raw content (bonuses/raw/*.md) is meant to become separate branded
 * deliverables (bonus-productizer, a later session) and, at most, get a
 * one-line teaser mention of its title in the book body — never its actual
 * content verbatim. Checks each bonus's substantive lines (its markdown
 * heading is exempt — a teaser mentioning the title is expected and fine)
 * for a leak into the rendered PDF text.
 */
export async function checkNoBonusInBody(ctx: QcContext): Promise<QcCheckResult> {
  const id = "no-bonus-in-body";

  if (ctx.inventory.bonuses.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "inventory.json lists no bonuses — nothing to check." };
  }

  const bodyText = normalize(ctx.fullText);
  const leaks: string[] = [];

  for (const bonus of ctx.inventory.bonuses) {
    let markdown: string;
    try {
      markdown = await readFile(path.join(ctx.projectRoot, bonus.file), "utf-8");
    } catch {
      return { id, status: "skipped", pass: false, evidence: `Bonus file ${bonus.file} (listed in inventory.json) could not be read.` };
    }

    const contentLines = markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/^\s*\d+[.)]\s+/, "").replace(/^\s*[-*]\s+/, ""))
      .filter((l) => l.length >= 15); // skip trivially short lines that could false-positive

    for (const line of contentLines) {
      if (bodyText.includes(normalize(line))) {
        leaks.push(`"${line}" (from ${bonus.id})`);
      }
    }
  }

  const pass = leaks.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `None of the ${ctx.inventory.bonuses.length} bonus(es)' content lines appear in the rendered book text (title-only teasers are fine).`
      : `${leaks.length} bonus content line(s) leaked into the book body: ${leaks.slice(0, 3).join(", ")}${leaks.length > 3 ? ", …" : ""}.`,
    details: { leaks },
  };
}
