import type { QcContext, QcCheckResult } from "../types.js";

interface OutlineNode {
  title: string;
  items: OutlineNode[];
}

function flattenTitles(nodes: OutlineNode[]): string[] {
  return nodes.flatMap((n) => [n.title, ...flattenTitles(n.items ?? [])]);
}

/** Chromium's tagged-PDF outline extraction can drop the space at a line-wrap boundary; compare ignoring whitespace. */
function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

const TOC_ENTRY_RE = /<li class="toc-entry">[\s\S]*?<a href="#([^"]+)"[\s\S]*?<span class="toc-pagenum" data-target="#([^"]+)">/g;
const ID_ATTR_RE = /\sid="([^"]+)"/g;

/**
 * Two independent, provable claims under one gate id: (1) every chapter in
 * inventory.json has a matching bookmark somewhere in the PDF's outline
 * tree (built from base.css's h1/h2/h3 via Playwright's `outline: true`);
 * (2) every TOC entry's href/data-target resolves to a real element id in
 * the same assembled HTML — checked against source, not the PDF's Link
 * annotations, since that's the one place both ends of the link are
 * declared together.
 */
export async function checkOutlineToc(ctx: QcContext): Promise<QcCheckResult> {
  const id = "outline-toc";

  const outline = (await ctx.pdfDoc.getOutline()) as OutlineNode[] | null;
  if (!outline || outline.length === 0) {
    return {
      id,
      status: "fail",
      pass: false,
      evidence: "PDF has no outline/bookmark tree at all.",
    };
  }

  const outlineTitles = flattenTitles(outline).map(normalize);
  const missingChapters = ctx.inventory.chapters.filter(
    (ch) => !outlineTitles.some((t) => t === normalize(ch.title) || t.includes(normalize(ch.title))),
  );

  let brokenLinks: string[] = [];
  if (ctx.bookHtml) {
    const ids = new Set<string>();
    for (const match of ctx.bookHtml.matchAll(ID_ATTR_RE)) ids.add(match[1]);
    for (const match of ctx.bookHtml.matchAll(TOC_ENTRY_RE)) {
      const [, hrefTarget, dataTarget] = match;
      if (!ids.has(hrefTarget)) brokenLinks.push(`href="#${hrefTarget}"`);
      if (!ids.has(dataTarget)) brokenLinks.push(`data-target="#${dataTarget}"`);
    }
  }

  const pass = missingChapters.length === 0 && brokenLinks.length === 0;
  const parts: string[] = [];
  parts.push(
    missingChapters.length === 0
      ? `All ${ctx.inventory.chapters.length} chapter(s) have a matching PDF outline entry (${outline.length} top-level bookmark(s) found).`
      : `${missingChapters.length} chapter(s) missing from the PDF outline: ${missingChapters.map((c) => c.title).join(", ")}.`,
  );
  if (ctx.bookHtml) {
    parts.push(
      brokenLinks.length === 0
        ? "All TOC entry hrefs/data-targets resolve to a real element id."
        : `${brokenLinks.length} unresolved TOC link(s): ${brokenLinks.join(", ")}.`,
    );
  } else {
    parts.push("(no html/<slug>-book.html found — TOC link resolution not checked, only outline coverage.)");
  }

  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: parts.join(" "),
    details: { missingChapters: missingChapters.map((c) => c.title), brokenLinks },
  };
}
