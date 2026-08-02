import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Loaded once and cached: the paged.js browser polyfill, inlined into every rendered document. */
let pagedPolyfillPromise: Promise<string> | undefined;
function loadPagedPolyfill(): Promise<string> {
  if (!pagedPolyfillPromise) {
    // pagedjs's package.json "exports" map only exposes its bare entry points (not
    // ./dist/paged.polyfill.js) under standard require/import conditions, so we resolve
    // the package root from its main entry and reach into dist/ ourselves.
    const pagedjsEntry = require.resolve("pagedjs");
    const pagedjsRoot = path.dirname(path.dirname(pagedjsEntry));
    const polyfillPath = path.join(pagedjsRoot, "dist", "paged.polyfill.js");
    pagedPolyfillPromise = readFile(polyfillPath, "utf-8");
  }
  return pagedPolyfillPromise;
}

export interface RenderOptions {
  /** HTML injected into <body>; this is what Paged.js paginates. */
  bodyHtml: string;
  /** Raw CSS, concatenated and inlined in a single <style> tag (must include @page rules). */
  css: string[];
  /** Absolute path where the paginated PDF is written. */
  outputPdfPath: string;
  /** If set, one PNG per rendered page is written here as page-001.png, page-002.png, ... */
  previewsDir?: string;
  title?: string;
  /** BCP-47 language tag for the <html lang> attribute. Defaults to en-US (project output language). */
  lang?: string;
  /** Paged.js pagination timeout in ms. Defaults to 60s. */
  timeoutMs?: number;
}

export interface RenderResult {
  pdfPath: string;
  pageCount: number;
  previewPaths: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildDocument(options: RenderOptions): Promise<string> {
  const polyfill = await loadPagedPolyfill();
  const css = options.css.join("\n");
  const lang = options.lang ?? "en-US";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title ?? "")}</title>
<style>${css}</style>
</head>
<body>
${options.bodyHtml}
<script>window.PagedConfig = { auto: false };</script>
<script>${polyfill}</script>
</body>
</html>`;
}

/**
 * Renders HTML through Paged.js pagination in a real browser, then prints the
 * paginated result to a PDF (and optionally one PNG per page) via Playwright.
 */
export async function renderToPdf(options: RenderOptions): Promise<RenderResult> {
  const html = await buildDocument(options);
  const timeoutMs = options.timeoutMs ?? 60_000;

  await mkdir(path.dirname(options.outputPdfPath), { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    await page.evaluate(async () => {
      await document.fonts.ready;
      const Paged = (window as unknown as { Paged: { Previewer: new () => PagedPreviewer } }).Paged;
      const previewer = new Paged.Previewer();
      (window as unknown as { __pagedRendered: boolean }).__pagedRendered = false;
      previewer.on("rendered", (flow: { total: number }) => {
        (window as unknown as { __pagedRendered: boolean }).__pagedRendered = true;
        (window as unknown as { __pagedPageCount: number }).__pagedPageCount = flow.total;
      });
      await previewer.preview();
    });

    await page.waitForFunction(
      () => (window as unknown as { __pagedRendered?: boolean }).__pagedRendered === true,
      { timeout: timeoutMs },
    );

    const pageCount = await page.evaluate(
      () => (window as unknown as { __pagedPageCount: number }).__pagedPageCount,
    );

    await page.pdf({
      path: options.outputPdfPath,
      printBackground: true,
      preferCSSPageSize: true,
    });

    const previewPaths: string[] = [];
    if (options.previewsDir) {
      await mkdir(options.previewsDir, { recursive: true });
      const pageEls = await page.locator(".pagedjs_page").all();
      for (let i = 0; i < pageEls.length; i++) {
        const filePath = path.join(options.previewsDir, `page-${String(i + 1).padStart(3, "0")}.png`);
        await pageEls[i].screenshot({ path: filePath });
        previewPaths.push(filePath);
      }
    }

    return { pdfPath: options.outputPdfPath, pageCount, previewPaths };
  } finally {
    await browser.close();
  }
}

/** Minimal shape of Paged.js's Previewer, enough to drive pagination from evaluate(). */
interface PagedPreviewer {
  on(event: "rendered", handler: (flow: { total: number }) => void): void;
  preview(): Promise<{ total: number }>;
}
