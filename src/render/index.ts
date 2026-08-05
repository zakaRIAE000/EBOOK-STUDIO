import { chromium, type Browser, type Page } from "playwright";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Inlines local font url()s (relative to `baseDir`) as base64 data URIs.
 * base.css keeps ordinary relative @font-face paths (portable, valid CSS on
 * its own); this is what lets renderToPdf load that CSS via page.setContent
 * with no base URL and still have Chromium find + embed the fonts (needed
 * for the fonts-embedded QC gate) rather than silently failing to resolve
 * relative paths against about:blank.
 */
const FONT_URL_RE = /url\((["']?)((?:(?!\1)[^)])+\.(?:ttf|otf|woff2?))\1\)/gi;

function fontMimeType(ext: string): string {
  if (ext === "otf") return "font/otf";
  if (ext === "woff2") return "font/woff2";
  if (ext === "woff") return "font/woff";
  return "font/ttf";
}

export async function inlineLocalFontUrls(css: string, baseDir: string): Promise<string> {
  let result = css;
  for (const match of css.matchAll(FONT_URL_RE)) {
    const [full, quote, rawUrl] = match;
    if (/^(https?:)?\/\//.test(rawUrl) || rawUrl.startsWith("data:")) continue;
    const absPath = path.resolve(baseDir, rawUrl);
    const buffer = await readFile(absPath);
    const mime = fontMimeType(path.extname(absPath).slice(1).toLowerCase());
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    const q = quote || '"';
    result = result.replace(full, `url(${q}${dataUrl}${q})`);
  }
  return result;
}

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
  /**
   * Directory that relative asset URLs inside `bodyHtml` (`<img src="cover/final/...">`,
   * `<image href="visuals/...">`) are written relative to — normally the project root.
   * Without it those URLs resolve against about:blank and silently fail to load; see
   * the note on openPaginatedDocument.
   */
  baseDir?: string;
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

async function buildDocument(options: Pick<RenderOptions, "bodyHtml" | "css" | "title" | "lang">): Promise<string> {
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

export interface PaginatedDocument {
  browser: Browser;
  page: Page;
  pageCount: number;
}

/**
 * Opens `options.bodyHtml`/`options.css` in a real browser and runs Paged.js
 * pagination to completion. Shared by renderToPdf (which then prints/screenshots
 * the result) and src/qc's no-overflow check (which instead measures the live
 * DOM before ever calling page.pdf()) — both need the exact same pagination
 * pass, not two implementations that could silently drift apart.
 * Caller owns the returned browser and must close it.
 *
 * `page.setContent()` writes the document into whatever page is currently open
 * without navigating, so the document URL — and therefore the base URL every
 * relative asset URL resolves against — is inherited from the page's current
 * location. On a fresh page that location is `about:blank`, against which
 * `cover/final/<x>.png` resolves to nothing and loads as a broken image: no
 * request is made, no error is raised, and the PDF prints the alt text.
 * Navigating to `baseDir` first makes relative asset URLs resolve against the
 * project directory, exactly as they do when the written html/<slug>-book.html
 * is opened directly. Fonts take the other route (inlined as data URIs by
 * inlineLocalFontUrls) because their url()s are relative to the *stylesheet*,
 * which has no location of its own once the CSS is inlined in a <style> tag.
 */
export async function openPaginatedDocument(
  options: Pick<RenderOptions, "bodyHtml" | "css" | "title" | "lang" | "baseDir" | "timeoutMs">,
): Promise<PaginatedDocument> {
  const html = await buildDocument(options);
  const timeoutMs = options.timeoutMs ?? 60_000;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  if (options.baseDir) {
    // Trailing separator: a directory URL must end in "/" or the last segment
    // is treated as a file name and stripped when resolving relative URLs.
    await page.goto(pathToFileURL(path.join(options.baseDir, path.sep)).href);
  }
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

  return { browser, page, pageCount };
}

/**
 * Renders HTML through Paged.js pagination in a real browser, then prints the
 * paginated result to a PDF (and optionally one PNG per page) via Playwright.
 */
export async function renderToPdf(options: RenderOptions): Promise<RenderResult> {
  await mkdir(path.dirname(options.outputPdfPath), { recursive: true });

  const { browser, page, pageCount } = await openPaginatedDocument(options);
  try {
    await page.pdf({
      path: options.outputPdfPath,
      printBackground: true,
      preferCSSPageSize: true,
      // Embeds a real bookmark tree (from h1/h2/h3) and tagged/accessible
      // structure — the latter is also what makes Chromium populate the
      // PDF's /Lang from <html lang>, which the qc metadata gate reads.
      outline: true,
      tagged: true,
    });

    const previewPaths: string[] = [];
    if (options.previewsDir) {
      await mkdir(options.previewsDir, { recursive: true });
      // Previews are written page-by-page under a name derived from the index,
      // so a render that produces fewer pages than the last one leaves the tail
      // of the old set behind. Those orphans are indistinguishable from real
      // pages to anything reading the directory afterwards: the qc gates pair
      // previews with PDF pages positionally, and a stale page-089.png silently
      // shifted that pairing and cost ink-coverage its front-matter exemption.
      // The directory must describe this render only.
      for (const file of await readdir(options.previewsDir)) {
        if (/^page-\d+\.png$/i.test(file)) await rm(path.join(options.previewsDir, file));
      }
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
