import { readFile } from "node:fs/promises";
import path from "node:path";
import { inlineLocalFontUrls, openPaginatedDocument } from "../../render/index.js";
import type { QcContext, QcCheckResult } from "../types.js";

const TOLERANCE_PX = 2;

interface OverflowEntry {
  page: number;
  tag: string;
  className: string;
  overflowPx: number;
}

/**
 * Re-runs the exact same Paged.js pagination pass that produced the book
 * (html/<slug>-book.html + base.css + the project's tokens.css, via
 * src/render's shared openPaginatedDocument) and measures the live DOM
 * before any PDF is printed — screenshots alone can't tell "text that
 * reflowed to fit" from "text quietly clipped past the page edge".
 */
export async function checkNoOverflow(ctx: QcContext): Promise<QcCheckResult> {
  const id = "no-overflow";

  if (!ctx.bookHtml || !ctx.bookHtmlPath) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "No assembled html/<slug>-book.html found for this project — nothing to re-paginate and measure.",
    };
  }

  const baseCssPath = path.join(ctx.repoRoot, "templates", "base.css");
  const baseCssRaw = await readFile(baseCssPath, "utf-8");
  const baseCss = await inlineLocalFontUrls(baseCssRaw, path.dirname(baseCssPath));

  const { browser, page } = await openPaginatedDocument({
    bodyHtml: ctx.bookHtml,
    css: [baseCss, ctx.tokensCss],
    title: ctx.resolvedConfig.project.title,
  });

  try {
    const overflows = await page.evaluate((tolerance) => {
      const found: OverflowEntry[] = [];
      const containers = Array.from(document.querySelectorAll(".pagedjs_page_content"));
      containers.forEach((container, pageIndex) => {
        const cRect = container.getBoundingClientRect();
        container.querySelectorAll("*").forEach((el) => {
          // Two known Paged.js/Chromium box-measurement quirks, neither a real rendering
          // defect (verified by comparing against the actual preview screenshots, which
          // show clean, correctly-bounded pages in both cases):
          //  1. Paged.js's own structural wrapper — the immediate `.pagedjs_page_content > div`
          //     its own stylesheet creates to hold a section's flowed/split fragment — reports
          //     getBoundingClientRect/offsetWidth/scrollWidth around 5x the true column width
          //     when the wrapped section has been split across pages (data-split-from/-to).
          //     It's Paged.js's own scaffolding, not authored template markup.
          //  2. .back-cover's own box (flex + min-height: calc(...), see base.css's comment on
          //     it) shows the same inflated getBoundingClientRect/offsetWidth while
          //     getComputedStyle/scrollWidth agree with the container.
          // Both are exempted at exactly the element that carries the quirk — their children
          // (the actual authored content) still go through this same scan.
          const isPagedInternalWrapper =
            el.tagName === "DIV" && el.parentElement?.classList.contains("pagedjs_page_content");
          if (isPagedInternalWrapper || el.classList.contains("back-cover")) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;

          // Quirk 3, the same width inflation as quirk 1 but on the split
          // element itself rather than Paged.js's wrapper around it. Any
          // element carrying data-split-from/-to has been fragmented across
          // pages, and its getBoundingClientRect().width comes back roughly 5x
          // the true column — the assembled book's copyright page reported
          // +1576px horizontally on a 418px column while rendering perfectly
          // inside its margins, verified against the page screenshot.
          //
          // Scoped to the horizontal axis on purpose: vertical overflow is the
          // measurement that actually detects clipped text, so a fragmented
          // element is still fully checked top and bottom. Exempting it outright
          // would blind the gate to the one failure mode it exists to catch.
          const isSplitFragment =
            el.hasAttribute("data-split-from") || el.hasAttribute("data-split-to");
          const overflowPx = isSplitFragment
            ? Math.max(r.bottom - cRect.bottom, cRect.top - r.top)
            : Math.max(
                r.right - cRect.right,
                r.bottom - cRect.bottom,
                cRect.left - r.left,
                cRect.top - r.top,
              );
          if (overflowPx > tolerance) {
            found.push({
              page: pageIndex + 1,
              tag: el.tagName.toLowerCase(),
              className: (el as HTMLElement).className || "",
              overflowPx: Math.round(overflowPx * 10) / 10,
            });
          }
        });
      });
      return found;
    }, TOLERANCE_PX);

    const pass = overflows.length === 0;
    return {
      id,
      status: pass ? "pass" : "fail",
      pass,
      evidence: pass
        ? `No element exceeded its page content box by more than ${TOLERANCE_PX}px across ${ctx.pageCount} paginated page(s).`
        : `${overflows.length} element(s) exceeded their page content box by more than ${TOLERANCE_PX}px: ${overflows
            .slice(0, 5)
            .map((o) => `page ${o.page} <${o.tag}${o.className ? `.${o.className.split(" ")[0]}` : ""}> (+${o.overflowPx}px)`)
            .join(", ")}${overflows.length > 5 ? ", …" : ""}.`,
      details: { overflows },
    };
  } finally {
    await browser.close();
  }
}
