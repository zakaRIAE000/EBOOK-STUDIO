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

interface SourceGroup {
  label: string;
  words: string[];
}

/**
 * The front-matter and back-matter copy that comes from config/resolved.yaml
 * rather than from a chapter file.
 *
 * The conditions below mirror src/assemble exactly, because a section that
 * assembly deliberately skips is not missing text — the CTA and back cover are
 * only composed when the project actually supplies their copy (R3), and the
 * disclaimer block is dropped when it is empty. Scoring copy that was never
 * meant to be rendered would fail honest books.
 */
function configSourcedGroups(config: QcContext["resolvedConfig"]): SourceGroup[] {
  const groups: SourceGroup[] = [];

  const disclaimer = config.disclaimer?.text?.trim();
  if (disclaimer) groups.push({ label: "disclaimer", words: wordsOf(disclaimer) });

  const bm = config.backMatter;
  if (bm?.ctaTitle?.trim() && bm?.ctaContent?.trim()) {
    const cta = [bm.ctaTitle, bm.ctaContent];
    // The button — and so its label — is only rendered when there is a link.
    if (bm.ctaLink?.trim() && bm.ctaLinkLabel?.trim()) cta.push(bm.ctaLinkLabel);
    groups.push({ label: "CTA", words: wordsOf(cta.join(" ")) });
  }

  if (bm?.backCoverPunchline?.trim() && (bm.backCoverBullets?.length ?? 0) > 0) {
    groups.push({ label: "back cover", words: wordsOf([bm.backCoverPunchline, ...bm.backCoverBullets].join(" ")) });
  }

  return groups;
}

/**
 * ≥95% of the book's source words must show up in the PDF's text layer.
 * Word-multiset overlap (order-independent) rather than exact substring
 * matching: pagination/hyphenation can reflow text across page boundaries,
 * but every word should still be there, selectable, once.
 *
 * The source set is the chapters *and* the copy that config/resolved.yaml
 * supplies — the disclaimer, the CTA and the back cover. Those are rendered
 * into the book just as chapters are, but they live in brand-input.md instead
 * of content/chapters/, and checking only inventory.json left them verified by
 * nothing at all: gold shipped a GO with a line of its legal disclaimer clipped
 * out of the PDF, and no gate was looking at that text.
 *
 * Each group is scored against the threshold on its own as well as in total.
 * The front matter is ~2% of the book by volume, so folding it into one
 * combined percentage would let its entire loss disappear inside the rounding
 * on 12,000 chapter words.
 *
 * Deliberately still excludes bonuses/raw — bonuses ship as separate
 * deliverables and must never appear in the book body (see no-bonus-in-body).
 */
export async function checkTextCoverage(ctx: QcContext): Promise<QcCheckResult> {
  const id = "text-coverage";

  if (ctx.inventory.chapters.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "inventory.json has no chapters to check coverage against." };
  }

  let chapterWords: string[] = [];
  for (const chapter of ctx.inventory.chapters) {
    try {
      const markdown = await readFile(path.join(ctx.projectRoot, chapter.file), "utf-8");
      chapterWords = chapterWords.concat(wordsOf(stripMarkdown(markdown)));
    } catch {
      return {
        id,
        status: "skipped",
        pass: false,
        evidence: `Chapter file ${chapter.file} (listed in inventory.json) could not be read.`,
      };
    }
  }

  if (chapterWords.length === 0) {
    return { id, status: "skipped", pass: false, evidence: "Source chapters contain no words to check." };
  }

  // Smallest groups first: they draw from the shared pool before the 12,000-word
  // chapter set can consume the common words they share with it.
  const groups: SourceGroup[] = [
    ...configSourcedGroups(ctx.resolvedConfig),
    { label: `chapters (${ctx.inventory.chapters.length})`, words: chapterWords },
  ];

  const pool = wordMultiset(wordsOf(ctx.fullText));
  const scored = groups.map((group) => {
    let matched = 0;
    for (const word of group.words) {
      const remaining = pool.get(word) ?? 0;
      if (remaining > 0) {
        matched++;
        pool.set(word, remaining - 1);
      }
    }
    return { label: group.label, matched, total: group.words.length, coverage: matched / group.words.length };
  });

  const totalMatched = scored.reduce((sum, g) => sum + g.matched, 0);
  const totalWords = scored.reduce((sum, g) => sum + g.total, 0);
  const coverage = totalMatched / totalWords;

  const failing = scored.filter((g) => g.coverage < MIN_COVERAGE);
  const pass = failing.length === 0 && coverage >= MIN_COVERAGE;
  const breakdown = scored.map((g) => `${g.label} ${g.matched}/${g.total} (${(g.coverage * 100).toFixed(1)}%)`).join(", ");

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `${totalMatched}/${totalWords} source word(s) found in the PDF text layer (${(coverage * 100).toFixed(1)}%, threshold ${(MIN_COVERAGE * 100).toFixed(0)}% per group): ${breakdown}.`
      : `Below the ${(MIN_COVERAGE * 100).toFixed(0)}% threshold: ${failing.map((g) => `${g.label} at ${(g.coverage * 100).toFixed(1)}%`).join(", ")}. Full breakdown: ${breakdown}.`,
    details: { coverage, matched: totalMatched, total: totalWords, groups: scored },
  };
}
