import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "../design/index.js";
import { openPaginatedDocument, inlineLocalFontUrls } from "../render/index.js";

export class BonusError extends Error {}

/**
 * Turns a raw bonus (pulled out of the book body at ingest) into a standalone
 * deliverable, per skills/bonus-productizer.
 *
 * Two formats are implemented:
 *
 *  - `checklist` — a branded one-pager using the same `.checklist-box` markup
 *    the book uses. Nothing special: Paged.js renders it and we print.
 *
 *  - `worksheet` — content the reader writes into, which must carry REAL
 *    AcroForm fields. Playwright's page.pdf() flattens HTML <input> elements to
 *    their visual rendering, so a worksheet rendered the ordinary way is a
 *    picture of a worksheet. The fix, per the skill: render a static layout,
 *    measure where each field box actually landed, then add AcroForm text
 *    fields at those coordinates with pdf-lib.
 *
 * R8: `fillable` in the result is set from the field count read back OUT of the
 * written PDF, never from the fact that we intended to add fields.
 */

export type BonusFormat = "checklist" | "worksheet";

/** CSS px -> PDF points. Chromium lays out at 96dpi; PDF user space is 72dpi. */
const PX_TO_PT = 72 / 96;

export interface BonusOptions {
  projectSlug: string;
  repoRoot: string;
  /** `id` from inventory.json's bonuses[]. */
  bonusId: string;
  format: BonusFormat;
  /** Human-assigned standalone price, e.g. "$27". Never invented here (R3). */
  displayedValue?: string;
}

export interface BonusResult {
  projectRoot: string;
  bonusId: string;
  format: BonusFormat;
  htmlPath: string;
  pdfPath: string;
  pageCount: number;
  /** Worksheet only. Read back from the written file — proof, not intent. */
  formFields: string[];
  fillable: boolean;
}

interface FieldBox {
  name: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Splits a `•`-delimited run into its items. Ingest flattens these into one paragraph. */
function splitBullets(line: string): string[] {
  return line
    .split("•")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface BonusItem {
  /** The actionable line: a check to tick, or a worksheet field's numbered line. */
  text: string;
  /**
   * A worked example belonging to the line above it. Checklist only. Rendered
   * under its item WITHOUT its own checkbox — the source writes these as
   * sibling bullets, but an example is something you read, not something you
   * tick, so giving it a box misstates what the reader is meant to do with it.
   * Pairing is structural only: the text is unchanged and nothing is merged
   * away (R2).
   */
  note?: string;
}

interface ParsedBonus {
  title: string;
  intro: string[];
  items: BonusItem[];
  /** Trailing prose after the items. */
  outro: string[];
}

/**
 * Reads the raw bonus markdown. Deliberately structural only — no text is
 * rewritten, reordered or summarised (R2/R3); items are lifted verbatim.
 */
function parseBonus(markdown: string, format: BonusFormat): ParsedBonus {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  let title = "";
  const intro: string[] = [];
  const items: BonusItem[] = [];
  const outro: string[] = [];

  const NUMBERED_LINE = /^\d+\.\s/;
  const EXAMPLE_LINE = /^example\b/i;

  for (const block of blocks) {
    if (/^#\s/.test(block)) continue; // the "# BONUS" marker
    if (/^##\s/.test(block)) {
      title = block.replace(/^##\s*/, "").trim();
      continue;
    }

    // A worksheet's write-in fields are its NUMBERED lines, and only those.
    // Test that before any bullet handling: each numbered field also contains
    // `•` separating its label from its guidance and example, so splitting the
    // block on `•` first would shred every field into three fragments and
    // silently turn guidance text into extra form fields. It also keeps
    // non-field bullet runs (e.g. a closing "go or no go" rule) as prose —
    // they are read, not written into.
    if (format === "worksheet") {
      const numbered = block.split("\n").map((l) => l.trim()).filter((l) => NUMBERED_LINE.test(l));
      if (numbered.length > 0) {
        items.push(...numbered.map((l) => ({ text: l.replace(NUMBERED_LINE, "") })));
        continue;
      }
      (items.length ? outro : intro).push(block);
      continue;
    }

    // A checklist's items are its bullet run. The source alternates a check
    // with a worked example as sibling bullets; an example attaches to the
    // check above it rather than becoming a tickable item of its own.
    if (block.includes("•")) {
      for (const bullet of splitBullets(block)) {
        const previous = items[items.length - 1];
        if (EXAMPLE_LINE.test(bullet) && previous && !previous.note) {
          previous.note = bullet;
        } else {
          items.push({ text: bullet });
        }
      }
      continue;
    }
    (items.length ? outro : intro).push(block);
  }

  if (!title) throw new BonusError("Raw bonus markdown has no `## <title>` heading to read.");
  return { title, intro, items, outro };
}

/**
 * A worksheet field's visible label is the text before its first `•`; the rest
 * is guidance the reader reads but does not write into. Only the label names
 * the field, so that is what the AcroForm field is named after.
 */
function fieldLabel(item: string): { label: string; guidance: string[] } {
  const parts = item.split("•").map((s) => s.trim()).filter(Boolean);
  return { label: parts[0] ?? item, guidance: parts.slice(1) };
}

function buildChecklistHtml(parsed: ParsedBonus, cfg: ProjectConfig, value?: string): string {
  const intro = parsed.intro.map((p) => `      <p>${escapeHtml(p)}</p>`).join("\n");
  const items = parsed.items
    .map((i) => {
      const note = i.note ? `\n          <p class="checklist-example">${escapeHtml(i.note)}</p>` : "";
      return `        <li class="checklist-item"><span class="checklist-box"></span>${escapeHtml(i.text)}${note}</li>`;
    })
    .join("\n");
  const outro = parsed.outro.map((p) => `      <p>${escapeHtml(p)}</p>`).join("\n");
  return `<section class="bonus-sheet">
  <header class="bonus-sheet-header">
    <p class="bonus-sheet-brand">${escapeHtml(cfg.project.author)}</p>
    <h1 class="bonus-sheet-title">${escapeHtml(parsed.title)}</h1>
    ${value ? `<p class="bonus-sheet-value">${escapeHtml(value)} value</p>` : ""}
  </header>
  <div class="bonus-sheet-body">
${intro}
      <ul class="checklist">
${items}
      </ul>
${outro}
  </div>
</section>
`;
}

function buildWorksheetHtml(parsed: ParsedBonus, cfg: ProjectConfig, value?: string): string {
  const intro = parsed.intro.map((p) => `      <p>${escapeHtml(p)}</p>`).join("\n");
  const rows = parsed.items
    .map((item, i) => {
      const { label, guidance } = fieldLabel(item.text);
      const guide = guidance.length
        ? `\n          <p class="worksheet-guide">${escapeHtml(guidance.join(" · "))}</p>`
        : "";
      return `        <li class="worksheet-field">
          <p class="worksheet-label">${escapeHtml(label)}</p>${guide}
          <span class="worksheet-rule" data-field="f${i + 1}" data-field-label="${escapeHtml(label)}"></span>
        </li>`;
    })
    .join("\n");
  const outro = parsed.outro.map((p) => `      <p>${escapeHtml(p)}</p>`).join("\n");
  return `<section class="bonus-sheet">
  <header class="bonus-sheet-header">
    <p class="bonus-sheet-brand">${escapeHtml(cfg.project.author)}</p>
    <h1 class="bonus-sheet-title">${escapeHtml(parsed.title)}</h1>
    ${value ? `<p class="bonus-sheet-value">${escapeHtml(value)} value</p>` : ""}
  </header>
  <div class="bonus-sheet-body">
${intro}
      <ol class="worksheet-fields">
${rows}
      </ol>
${outro}
  </div>
</section>
`;
}

/**
 * Measures every `.worksheet-rule` in the paginated DOM and converts it to PDF
 * user-space coordinates.
 *
 * Paged.js lays each page out as a `.pagedjs_page` element, so a field's page
 * index is its ancestor page's index and its position is its offset within that
 * page's box. PDF's origin is bottom-left, the DOM's is top-left, hence the
 * flip against page height.
 */
async function measureFields(page: Awaited<ReturnType<typeof openPaginatedDocument>>["page"]): Promise<FieldBox[]> {
  const raw = await page.evaluate(() => {
    const out: { name: string; label: string; pageIndex: number; x: number; y: number; width: number; height: number }[] = [];
    const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
    for (const el of Array.from(document.querySelectorAll("[data-field]"))) {
      const host = el.closest(".pagedjs_page");
      if (!host) continue;
      const pageIndex = pages.indexOf(host);
      if (pageIndex < 0) continue;
      const r = el.getBoundingClientRect();
      const p = host.getBoundingClientRect();
      out.push({
        name: (el as HTMLElement).dataset.field ?? "",
        label: (el as HTMLElement).dataset.fieldLabel ?? "",
        pageIndex,
        x: r.left - p.left,
        y: r.top - p.top,
        width: r.width,
        height: r.height,
      });
    }
    return out;
  });

  return raw.map((f) => ({
    name: f.name,
    pageIndex: f.pageIndex,
    x: f.x * PX_TO_PT,
    y: f.y * PX_TO_PT,
    width: f.width * PX_TO_PT,
    height: f.height * PX_TO_PT,
  }));
}

/**
 * Adds a real AcroForm text field over each measured rule, then reads the field
 * names back out of the saved document. The returned names come from the file,
 * so "fillable" is provable rather than asserted (R8).
 */
async function addFormFields(pdfPath: string, boxes: FieldBox[]): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  const form = pdf.getForm();
  const pages = pdf.getPages();

  for (const box of boxes) {
    const page = pages[box.pageIndex];
    if (!page) continue;
    const { height: pageHeight } = page.getSize();
    const field = form.createTextField(box.name);
    field.addToPage(page, {
      x: box.x,
      y: pageHeight - box.y - box.height, // DOM top-left -> PDF bottom-left
      width: box.width,
      height: box.height,
      borderWidth: 0,
      backgroundColor: undefined,
      textColor: rgb(0.93, 0.92, 0.89),
    });
  }

  await writeFile(pdfPath, await pdf.save());

  // Read back from disk — the only honest source for "did this work".
  const verify = await PDFDocument.load(await readFile(pdfPath));
  return verify.getForm().getFields().map((f) => f.getName());
}

export async function generateBonus(options: BonusOptions): Promise<BonusResult> {
  const projectRoot = path.join(options.repoRoot, "workspace", "projects", options.projectSlug);

  let config: ProjectConfig;
  try {
    config = parseYaml(await readFile(path.join(projectRoot, "config", "resolved.yaml"), "utf-8")) as ProjectConfig;
  } catch {
    throw new BonusError(`No config/resolved.yaml for "${options.projectSlug}". Run studio:design first.`);
  }

  let inventory: { bonuses: { id: string; title: string; file: string }[] };
  try {
    inventory = JSON.parse(await readFile(path.join(projectRoot, "inventory.json"), "utf-8"));
  } catch {
    throw new BonusError(`No inventory.json for "${options.projectSlug}". Run studio:ingest first.`);
  }

  const entry = inventory.bonuses.find((b) => b.id === options.bonusId);
  if (!entry) {
    const known = inventory.bonuses.map((b) => b.id).join(", ") || "(none)";
    throw new BonusError(`No bonus with id "${options.bonusId}" in inventory.json. Known ids: ${known}.`);
  }

  const markdown = await readFile(path.join(projectRoot, entry.file), "utf-8");
  const parsed = parseBonus(markdown, options.format);
  if (parsed.items.length === 0) {
    throw new BonusError(`Parsed no items out of ${entry.file} — nothing to render as a ${options.format}.`);
  }

  const bodyHtml =
    options.format === "checklist"
      ? buildChecklistHtml(parsed, config, options.displayedValue)
      : buildWorksheetHtml(parsed, config, options.displayedValue);

  const outDir = path.join(projectRoot, "bonuses", options.bonusId);
  await mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, `${options.bonusId}.html`);
  await writeFile(htmlPath, bodyHtml, "utf-8");

  const tokensPath = path.join(projectRoot, "design", "tokens.css");
  const bonusCssPath = path.join(options.repoRoot, "templates", "bonus-sheet.css");
  const css = [
    await inlineLocalFontUrls(await readFile(tokensPath, "utf-8"), path.dirname(tokensPath)),
    await inlineLocalFontUrls(await readFile(bonusCssPath, "utf-8"), path.dirname(bonusCssPath)),
  ];

  const pdfPath = path.join(outDir, `${options.bonusId}.pdf`);
  const { browser, page, pageCount } = await openPaginatedDocument({
    bodyHtml,
    css,
    title: parsed.title,
    lang: config.language,
  });

  let boxes: FieldBox[] = [];
  try {
    if (options.format === "worksheet") {
      boxes = await measureFields(page);
      if (boxes.length === 0) {
        throw new BonusError(
          "Worksheet rendered no measurable field rules — refusing to write a PDF that would look fillable but carry no form fields.",
        );
      }
    }
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, tagged: true });
  } finally {
    await browser.close();
  }

  let formFields: string[] = [];
  if (options.format === "worksheet") {
    formFields = await addFormFields(pdfPath, boxes);
    if (formFields.length !== boxes.length) {
      throw new BonusError(
        `Added ${boxes.length} field(s) but the saved PDF reports ${formFields.length}. The worksheet is not reliably fillable; not shipping it.`,
      );
    }
  }

  return {
    projectRoot,
    bonusId: options.bonusId,
    format: options.format,
    htmlPath,
    pdfPath,
    pageCount,
    formFields,
    fillable: options.format === "worksheet" && formFields.length > 0,
  };
}
