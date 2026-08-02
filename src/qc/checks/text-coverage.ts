import { readFile } from "node:fs/promises";
import path from "node:path";
import type { QcContext, QcCheckResult } from "../types.js";

const MIN_COVERAGE = 0.95;

/** Strips markdown syntax so what's left is just the words a reader would see. */
function stripMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/^\s*[-*]\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .replace(/\|/g, " "),
    )
    .join("\n");
}

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []);
}

function wordMultiset(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of words) map.set(w, (map.get(w) ?? 0) + 1);
  return map;
}

/**
 * ≥95% of the source chapters' words must show up in the PDF's text layer.
 * Word-multiset overlap (order-independent) rather than exact substring
 * matching: pagination/hyphenation can reflow text across page boundaries,
 * but every word should still be there, selectable, once.
 * Deliberately checks chapters only, not bonuses/raw — bonuses are meant to
 * ship as separate deliverables, never rendered into the book body
 * (see no-bonus-in-body), so they're outside this gate's source set.
 */
export async function checkTextCoverage(ctx: QcContext): Promise<QcCheckResult> {
  const id = "text-coverage";

  if (ctx.inventory.chapters.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "inventory.json has no chapters to check coverage against." };
  }

  let sourceWords: string[] = [];
  for (const chapter of ctx.inventory.chapters) {
    try {
      const markdown = await readFile(path.join(ctx.projectRoot, chapter.file), "utf-8");
      sourceWords = sourceWords.concat(wordsOf(stripMarkdown(markdown)));
    } catch {
      return {
        id,
        status: "skipped",
        pass: false,
        evidence: `Chapter file ${chapter.file} (listed in inventory.json) could not be read.`,
      };
    }
  }

  if (sourceWords.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "Source chapters contain no words to check." };
  }

  const extractedWords = wordMultiset(wordsOf(ctx.fullText));
  let matched = 0;
  for (const word of sourceWords) {
    const remaining = extractedWords.get(word) ?? 0;
    if (remaining > 0) {
      matched++;
      extractedWords.set(word, remaining - 1);
    }
  }

  const coverage = matched / sourceWords.length;
  const pass = coverage >= MIN_COVERAGE;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: `${matched}/${sourceWords.length} source word(s) from ${ctx.inventory.chapters.length} chapter(s) found in the PDF text layer (${(coverage * 100).toFixed(1)}%, threshold ${(MIN_COVERAGE * 100).toFixed(0)}%).`,
    details: { coverage, matched, total: sourceWords.length },
  };
}
