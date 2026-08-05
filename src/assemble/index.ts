import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "../design/index.js";
import type { Inventory } from "../ingest/index.js";
import { renderToPdf, inlineLocalFontUrls } from "../render/index.js";

export class AssembleError extends Error {}

/**
 * Composes every approved piece into one document, in the canonical order from
 * skills/pdf-assembly:
 *
 *   cover -> title page -> copyright + disclaimer -> bonus teaser
 *     -> table of contents -> chapters (inventory order) -> CTA -> back cover
 *
 * Assembly composes; it never re-decides layout. Each `html/<n>.html` was
 * approved at its own /chapter gate and is concatenated verbatim.
 *
 * Two sections are conditional by design rather than by omission:
 *   - the bonus teaser appears only when inventory.bonuses is non-empty;
 *   - the CTA and back cover appear only when the project actually supplies
 *     their copy. Neither punchline, bullets nor CTA text exists in
 *     brand-input.md or resolved.yaml, and writing them here would be inventing
 *     marketing claims about the book (R3). Skipped sections are reported, not
 *     filled with placeholder prose.
 */

export interface AssembleOptions {
  projectSlug: string;
  repoRoot: string;
}

export interface AssembleResult {
  projectRoot: string;
  bookHtmlPath: string;
  pdfPath: string;
  pageCount: number;
  previewPaths: string[];
  /** Canonical sections actually composed, in order. */
  sections: string[];
  /** Canonical sections deliberately omitted, with the reason. */
  skipped: { section: string; reason: string }[];
  tocEntries: { id: string; label: string }[];
  metadata: { title: string; author: string; language: string };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strips a template's leading documentation comment; it explains placeholders to whoever edits it. */
function stripTemplateComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").trim();
}

async function loadTemplate(repoRoot: string, relative: string): Promise<string> {
  const full = path.join(repoRoot, "templates", relative);
  try {
    return stripTemplateComments(await readFile(full, "utf-8"));
  } catch {
    throw new AssembleError(`Missing template ${relative} — expected at ${full}.`);
  }
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

/**
 * The id each chapter's wrapper actually carries. The TOC's href/data-target
 * must match it exactly — a typo here is a composition bug that
 * src/qc/checks/outline-toc.ts would only catch afterwards.
 */
function chapterAnchorId(chapterHtml: string): string | null {
  const match = chapterHtml.match(/<section class="chapter-open"[^>]*\bid="([^"]+)"/);
  return match ? match[1] : null;
}

function tocLabel(chapter: Inventory["chapters"][number]): string {
  return chapter.number === null ? chapter.title : `${String(chapter.number).padStart(2, "0")}. ${chapter.title}`;
}

/**
 * Places the running-header's book-title marker *inside* the first composed
 * section instead of before it.
 *
 * The marker is zero-footprint by style (position:absolute, 0x0, see base.css)
 * but not by layout: Paged.js still counts it as flowed content occupying a
 * page. base.css already documents this for the title page — it had to drop
 * `break-before` there because the marker sitting as a preceding sibling pushed
 * a blank page in front of it. Every candidate first section now re-triggers it
 * a different way: `.cover-page` carries `page: book-cover` and `.title-page`
 * carries `page: front-matter`, and a named-page change forces a break of its
 * own that no stylesheet edit can drop. Nesting the marker inside the section
 * removes the preceding sibling entirely, so page 1 is the cover (or, with no
 * cover, the title page) rather than a blank leaf. It stays the document's
 * first element, which is all `string-set` needs.
 */
function withTitleMarker(sectionHtml: string, marker: string): string {
  const openTag = sectionHtml.match(/<(?:section|div|main|article)\b[^>]*>/);
  if (openTag?.index === undefined) return `${marker}\n${sectionHtml}`;
  const insertAt = openTag.index + openTag[0].length;
  return sectionHtml.slice(0, insertAt) + marker + sectionHtml.slice(insertAt);
}

const RASTER_EXT_RE = /\.(png|jpe?g)$/i;

/**
 * Finds the print cover in `cover/final/`, whatever /cover named it.
 *
 * src/cover writes `<slug>-cover.print.png` today, but assembly has no business
 * re-deriving that filename: a project whose cover was produced by hand, under
 * an earlier naming scheme, or as a JPEG is still a project with a cover, and
 * reconstructing the expected name meant assembly silently skipped it instead.
 * The `.print.` marker is what actually matters — it distinguishes the 6x9in
 * 300dpi print render from the `.kindle.` listing image sitting beside it, which
 * is cropped to 1600x2560 and must never become the interior's first page.
 * Returns a project-root-relative POSIX path, the form asset references take in
 * the assembled HTML.
 */
async function findPrintCover(projectRoot: string): Promise<string | null> {
  const finalDir = path.join(projectRoot, "cover", "final");
  let entries: string[];
  try {
    entries = (await readdir(finalDir)).filter((f) => RASTER_EXT_RE.test(f));
  } catch {
    return null;
  }
  const chosen =
    entries.filter((f) => /\.print\./i.test(f)).sort()[0] ??
    // No `.print.` variant: fall back to any cover that isn't the Kindle listing
    // image or a back cover, so a hand-placed cover.png still gets composed.
    entries.filter((f) => !/\.kindle\.|back/i.test(f)).sort()[0];
  return chosen ? `cover/final/${chosen}` : null;
}

export async function assembleBook(options: AssembleOptions): Promise<AssembleResult> {
  const projectRoot = path.join(options.repoRoot, "workspace", "projects", options.projectSlug);

  let config: ProjectConfig;
  try {
    config = parseYaml(await readFile(path.join(projectRoot, "config", "resolved.yaml"), "utf-8")) as ProjectConfig;
  } catch {
    throw new AssembleError(`No config/resolved.yaml for "${options.projectSlug}". Run studio:design first.`);
  }

  let inventory: Inventory;
  try {
    inventory = JSON.parse(await readFile(path.join(projectRoot, "inventory.json"), "utf-8")) as Inventory;
  } catch {
    throw new AssembleError(`No inventory.json for "${options.projectSlug}". Run studio:ingest first.`);
  }

  // Disclaimer required but absent is a block on assembly, never something to
  // paper over with a generic placeholder (skills/pdf-assembly step 3).
  if (config.disclaimer.required && !config.disclaimer.text?.trim()) {
    throw new AssembleError(
      `config/resolved.yaml sets disclaimer.required = true for niche "${config.project.niche}" but carries no disclaimer text. Fill it in brand-input.md and re-run studio:design.`,
    );
  }

  const sections: string[] = [];
  const skipped: AssembleResult["skipped"] = [];
  const parts: string[] = [];

  // The running header's book-title string comes from this marker. It must
  // appear exactly once — a second copy would silently re-set the string
  // mid-document — and is nested into the first section (see withTitleMarker)
  // rather than pushed as a part of its own.
  const titleMarker = `<div class="doc-title-marker">${escapeHtml(config.project.title)}</div>`;

  // 1. Cover — the 6x9in/300dpi print render, not the Kindle listing image.
  const coverRelative = await findPrintCover(projectRoot);
  if (coverRelative) {
    parts.push(`<section class="cover-page"><img src="${coverRelative}" alt="${escapeHtml(config.project.title)}"></section>`);
    sections.push("cover");
  } else {
    skipped.push({ section: "cover", reason: "no print cover in cover/final/ — run studio:cover" });
  }

  // 2. Title page. base.css deliberately gives it no break-before.
  const titlePage = await loadTemplate(options.repoRoot, "frontmatter/title-page.html");
  parts.push(
    fill(titlePage, {
      BOOK_TITLE: escapeHtml(config.project.title),
      BOOK_SUBTITLE: escapeHtml(config.project.subtitle ?? ""),
      AUTHOR_NAME: escapeHtml(config.project.author),
      NICHE_KICKER: "",
    })
      // The template ships a marker of its own; ours is already emitted above.
      .replace(/<div class="doc-title-marker">[\s\S]*?<\/div>/, "")
      .replace(/<p class="title-page-kicker">\s*<\/p>/, "")
      .replace(/<p class="title-page-subtitle">\s*<\/p>/, ""),
  );
  sections.push("title-page");

  // 3. Copyright + disclaimer.
  const copyright = await loadTemplate(options.repoRoot, "frontmatter/copyright.html");
  const disclaimerHtml = (config.disclaimer.text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n    ");
  let copyrightHtml = fill(copyright, {
    BOOK_TITLE: escapeHtml(config.project.title),
    AUTHOR_NAME: escapeHtml(config.project.author),
    COPYRIGHT_YEAR: String(new Date().getFullYear()),
    PUBLISHER_NAME: escapeHtml(config.project.author),
    NICHE_DISCLAIMER: disclaimerHtml,
  });
  if (!disclaimerHtml) {
    copyrightHtml = copyrightHtml.replace(/<div class="disclaimer-block">[\s\S]*?<\/div>/, "");
  }
  parts.push(copyrightHtml);
  sections.push(config.disclaimer.required ? "copyright+disclaimer" : "copyright");

  // 4. Bonus teaser — only when there are bonuses.
  if (inventory.bonuses.length > 0) {
    const teaser = await loadTemplate(options.repoRoot, "frontmatter/bonus-teaser.html");
    const items = inventory.bonuses
      .map(
        (b) =>
          `<li class="bonus-teaser-item">\n      <p class="bonus-teaser-item-title">${escapeHtml(b.title)}</p>\n      <p>See bonuses/${escapeHtml(b.id)}/.</p>\n    </li>`,
      )
      .join("\n    ");
    parts.push(
      fill(teaser, {
        BONUS_INTRO: `${inventory.bonuses.length} companion deliverable${inventory.bonuses.length === 1 ? "" : "s"} are included with this book.`,
        BONUS_ITEMS: items,
      }),
    );
    sections.push("bonus-teaser");
  } else {
    skipped.push({ section: "bonus-teaser", reason: "inventory.json has no bonuses" });
  }

  // 5. TOC — built after the chapter ids are known, emitted before them.
  const chapterHtmls: { id: string; html: string }[] = [];
  for (const [index, chapter] of inventory.chapters.entries()) {
    const file = path.join(projectRoot, "html", `${index}.html`);
    let html: string;
    try {
      html = await readFile(file, "utf-8");
    } catch {
      throw new AssembleError(`Chapter "${chapter.id}" has no approved layout at html/${index}.html — run /chapter for it first.`);
    }
    const id = chapterAnchorId(html);
    if (!id) {
      throw new AssembleError(`html/${index}.html has no <section class="chapter-open" id="..."> wrapper; the TOC cannot target it.`);
    }
    chapterHtmls.push({ id, html });
  }

  const tocEntries = inventory.chapters.map((chapter, i) => ({ id: chapterHtmls[i].id, label: tocLabel(chapter) }));
  const toc = await loadTemplate(options.repoRoot, "frontmatter/toc.html");
  parts.push(
    fill(toc, {
      TOC_ENTRIES: tocEntries
        .map(
          (e) =>
            `<li class="toc-entry">\n      <a href="#${e.id}">${escapeHtml(e.label)}</a>\n      <span class="toc-leader"></span>\n      <span class="toc-pagenum" data-target="#${e.id}"></span>\n    </li>`,
        )
        .join("\n    "),
    }),
  );
  sections.push("toc");

  // 6. Chapters, in inventory order. The first one restarts the folio at
  // arabic 1; everything before it numbers in lower-roman.
  chapterHtmls.forEach(({ html }, i) => {
    parts.push(i === 0 ? html.replace('<section class="chapter-open"', '<section class="chapter-open body-start"') : html);
  });
  sections.push(`chapters (${chapterHtmls.length})`);

  // 7. CTA — only when the project supplies its copy. Never generated (R3).
  const bm = config.backMatter;
  if (bm.ctaTitle?.trim() && bm.ctaContent?.trim()) {
    const ctaTemplate = await loadTemplate(options.repoRoot, "backmatter/cta.html");
    let ctaHtml = fill(ctaTemplate, {
      CTA_TITLE: escapeHtml(bm.ctaTitle.trim()),
      CTA_CONTENT: escapeHtml(bm.ctaContent.trim()),
      CTA_LINK: escapeHtml(bm.ctaLink ?? ""),
      CTA_LINK_LABEL: escapeHtml(bm.ctaLinkLabel ?? ""),
    });
    // "Omit .cta-button if there is no link" — a button pointing nowhere is
    // worse than no button.
    if (!bm.ctaLink?.trim()) {
      ctaHtml = ctaHtml.replace(/<a class="cta-button"[\s\S]*?<\/a>\s*/, "");
    }
    parts.push(ctaHtml);
    sections.push("cta");
  } else {
    skipped.push({
      section: "cta",
      reason: "no CTA title/body in brand-input.md — writing one would invent an offer the project has not made (R3)",
    });
  }

  // 8. Back cover — same rule. Last page in reading order.
  if (bm.backCoverPunchline?.trim() && bm.backCoverBullets.length > 0) {
    const backCoverTemplate = await loadTemplate(options.repoRoot, "backmatter/back-cover.html");
    parts.push(
      fill(backCoverTemplate, {
        BACK_COVER_PUNCHLINE: escapeHtml(bm.backCoverPunchline.trim()),
        BACK_COVER_BULLETS: bm.backCoverBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n    "),
        // The template has no branding placeholder of its own — it reuses the
        // author/brand name already in config.
        AUTHOR_NAME: escapeHtml(config.project.author),
      }),
    );
    sections.push("back-cover");
  } else {
    skipped.push({
      section: "back-cover",
      reason: "no punchline or bullets in brand-input.md — writing them would invent claims about the book (R3)",
    });
  }

  parts[0] = withTitleMarker(parts[0], titleMarker);

  const bodyHtml = parts.join("\n\n");
  const htmlDir = path.join(projectRoot, "html");
  await mkdir(htmlDir, { recursive: true });
  const bookHtmlPath = path.join(htmlDir, `${options.projectSlug}-book.html`);
  await writeFile(bookHtmlPath, bodyHtml, "utf-8");

  const tokensPath = path.join(projectRoot, "design", "tokens.css");
  const baseCssPath = path.join(options.repoRoot, "templates", "base.css");
  const css = [
    await inlineLocalFontUrls(await readFile(tokensPath, "utf-8"), path.dirname(tokensPath)),
    await inlineLocalFontUrls(await readFile(baseCssPath, "utf-8"), path.dirname(baseCssPath)),
  ];

  const pdfPath = path.join(projectRoot, "output", `${options.projectSlug}-book.pdf`);
  const result = await renderToPdf({
    bodyHtml,
    css,
    outputPdfPath: pdfPath,
    previewsDir: path.join(projectRoot, "previews", "book"),
    title: config.project.title,
    lang: config.language,
    // Asset references in bodyHtml are project-root-relative (see findPrintCover),
    // and so is the html/<slug>-book.html we just wrote — both resolve from here.
    baseDir: projectRoot,
  });

  // Real PDF metadata, not just visible text on the title page —
  // src/qc/checks/metadata.ts reads the document fields.
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  pdf.setTitle(config.project.title);
  pdf.setAuthor(config.project.author);
  pdf.setLanguage(config.language);
  pdf.setSubject(config.project.niche);
  await writeFile(pdfPath, await pdf.save());

  return {
    projectRoot,
    bookHtmlPath,
    pdfPath,
    pageCount: result.pageCount,
    previewPaths: result.previewPaths,
    sections,
    skipped,
    tocEntries,
    metadata: { title: config.project.title, author: config.project.author, language: config.language },
  };
}
