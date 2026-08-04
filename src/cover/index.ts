import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "../design/index.js";
import { readImageSize } from "../qc/image-size.js";

export class CoverError extends Error {}

/**
 * The outside front cover. Deliberately NOT rendered through Paged.js.
 *
 * templates/base.css's `.back-cover` rule records that full-bleed past the
 * print margins was attempted under Paged.js's fragmentation engine and
 * abandoned — it produced inconsistent box sizes (getComputedStyle and
 * getBoundingClientRect disagreeing) — and states outright that the physical
 * outside cover is generated separately. This module is that separate path:
 * a fixed-size box with overflow:hidden, screenshotted directly, so no
 * fragmentation engine is involved and the geometry is not negotiable.
 */

/** Design space is 600x900 CSS px = 6x9in at 100dpi. */
const COVER_CSS_WIDTH = 600;
const COVER_CSS_HEIGHT = 900;

const OUTPUT_SPECS = {
  /** 6x9in at 300dpi — matches src/providers/types.ts's print spec. */
  print: { width: 1800, height: 2700, density: 300, scale: 3 },
  /** Kindle storefront listing size. */
  kindle: { width: 1600, height: 2560 },
} as const;

export type CoverSpec = keyof typeof OUTPUT_SPECS;

export interface CoverOptions {
  projectSlug: string;
  repoRoot: string;
  /** Background art, relative to the project root. Must carry no baked-in text. */
  art: string;
  /**
   * Leading fragment of the title, split off for typographic hierarchy only.
   * Validated to be a real prefix of the configured title — see splitTitle.
   */
  titleLead?: string;
  specs?: CoverSpec[];
}

export interface CoverResult {
  projectRoot: string;
  coverHtmlPath: string;
  outputs: { spec: CoverSpec; path: string; width: number; height: number }[];
  /** Live computed values read back out of the browser — evidence the tokens resolved (R7). */
  probe: CoverProbe;
  artDpi: { artWidth: number; fullBleedDpi: number; printSpecRatio: number };
}

interface CoverProbe {
  boxWidth: number;
  boxHeight: number;
  titleColor: string;
  leadColor: string;
  titleFontFamily: string;
  headingFontLoaded: boolean;
  /** Fractional height at which the type block ends — must clear the art's busy zone. */
  typeBottomRatio: number;
}

/**
 * Splits the title into a lead fragment and the remainder, enforcing that the
 * two halves rejoin into the configured title character-for-character. The
 * cover is the one place a title gets retypeset, and silently dropping or
 * rewording a word there would misrepresent the book — so the guarantee is
 * mechanical rather than a reviewer's promise.
 */
export function splitTitle(title: string, lead: string | undefined): { lead: string | null; main: string } {
  if (!lead) return { lead: null, main: title };
  const trimmedLead = lead.trim();
  if (!title.startsWith(trimmedLead)) {
    throw new CoverError(
      `--title-lead ${JSON.stringify(trimmedLead)} is not a prefix of the configured title ${JSON.stringify(title)}. ` +
        `The lead exists to split the real title for hierarchy, never to introduce new wording.`,
    );
  }
  const main = title.slice(trimmedLead.length).trim();
  if (!main) {
    throw new CoverError(`--title-lead ${JSON.stringify(trimmedLead)} consumes the entire title, leaving nothing for the main line.`);
  }
  const rejoined = `${trimmedLead} ${main}`;
  if (rejoined !== title) {
    throw new CoverError(
      `Title split is not lossless: ${JSON.stringify(rejoined)} != ${JSON.stringify(title)}. ` +
        `This usually means the split point falls inside unusual whitespace.`,
    );
  }
  return { lead: trimmedLead, main };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Composes the project's cover.html from templates/frontmatter/cover.html.
 * Paths stay relative to the written file so a plain file:// load resolves
 * tokens, CSS, fonts and art with no inlining step.
 */
function composeCoverHtml(
  template: string,
  values: { art: string; lead: string | null; main: string; subtitle: string | null; author: string; title: string; lang: string },
): string {
  // Strip the template's own documentation comments first. They explain the
  // placeholders to whoever edits the template, and substituting into them
  // would both leak that prose into every generated cover and rewrite the
  // placeholder names it is trying to document.
  let body = template
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/{{COVER_ART}}/g, escapeHtml(values.art))
    .replace(/{{TITLE_LEAD}}/g, escapeHtml(values.lead ?? ""))
    .replace(/{{TITLE_MAIN}}/g, escapeHtml(values.main))
    .replace(/{{BOOK_SUBTITLE}}/g, escapeHtml(values.subtitle ?? ""))
    .replace(/{{AUTHOR_NAME}}/g, escapeHtml(values.author));

  // Drop the optional lines entirely rather than leaving empty boxes that
  // still occupy vertical rhythm in the flex column.
  if (!values.lead) body = body.replace(/^\s*<p class="cover-title-lead">.*?<\/p>\s*$/m, "");
  if (!values.subtitle) body = body.replace(/^\s*<p class="cover-subtitle">.*?<\/p>\s*$/m, "");

  return `<!DOCTYPE html>
<!--
  GENERATED by \`npm run studio:cover\` — do not hand-edit.
  Regenerate instead; hand edits are lost on the next run.
  Composed from templates/frontmatter/cover.html.
-->
<html lang="${values.lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(values.title)} — cover</title>
<link rel="stylesheet" href="../design/tokens.css">
<link rel="stylesheet" href="../../../../templates/cover.css">
</head>
<body>
${body.trim()}
</body>
</html>
`;
}

export async function generateCover(options: CoverOptions): Promise<CoverResult> {
  const projectRoot = path.join(options.repoRoot, "workspace", "projects", options.projectSlug);
  const specs = options.specs?.length ? options.specs : (["print"] as CoverSpec[]);

  let config: ProjectConfig;
  try {
    config = parseYaml(await readFile(path.join(projectRoot, "config", "resolved.yaml"), "utf-8")) as ProjectConfig;
  } catch {
    throw new CoverError(`No config/resolved.yaml found for "${options.projectSlug}". Run studio:design first.`);
  }

  const artPath = path.join(projectRoot, options.art);
  let artBuffer: Buffer;
  try {
    artBuffer = await readFile(artPath);
  } catch {
    throw new CoverError(`Cover art not found at ${artPath} (--art is resolved relative to the project root).`);
  }
  const artSize = readImageSize(artBuffer, options.art);
  if (!artSize) {
    throw new CoverError(`Could not read image dimensions from ${options.art} — expected a PNG or JPEG.`);
  }

  const { lead, main } = splitTitle(config.project.title, options.titleLead);

  const templatePath = path.join(options.repoRoot, "templates", "frontmatter", "cover.html");
  const template = await readFile(templatePath, "utf-8");
  const html = composeCoverHtml(template, {
    art: options.art.replace(/^cover\//, ""),
    lead,
    main,
    subtitle: config.project.subtitle,
    author: config.project.author,
    title: config.project.title,
    lang: config.language,
  });

  const coverDir = path.join(projectRoot, "cover");
  const finalDir = path.join(coverDir, "final");
  await mkdir(finalDir, { recursive: true });
  const coverHtmlPath = path.join(coverDir, "cover.html");
  await writeFile(coverHtmlPath, html, "utf-8");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: COVER_CSS_WIDTH, height: COVER_CSS_HEIGHT },
      deviceScaleFactor: OUTPUT_SPECS.print.scale,
    });

    const failures: string[] = [];
    page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
    page.on("requestfailed", (req) => failures.push(`requestfailed: ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`));

    await page.goto(`file:///${coverHtmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    if (failures.length) {
      throw new CoverError(`Cover page failed to load cleanly:\n  ${failures.join("\n  ")}`);
    }

    // Read the rendered values back out rather than trusting the stylesheet —
    // a missing token or an unloaded font fails silently as a fallback (R7/R8).
    const probe: CoverProbe = await page.evaluate(() => {
      const box = document.querySelector(".cover") as HTMLElement;
      const title = document.querySelector(".cover-title-main") as HTMLElement;
      const leadEl = document.querySelector(".cover-title-lead") as HTMLElement | null;
      const type = document.querySelector(".cover-type") as HTMLElement;
      const rect = box.getBoundingClientRect();
      const titleStyle = getComputedStyle(title);
      return {
        boxWidth: rect.width,
        boxHeight: rect.height,
        titleColor: titleStyle.color,
        leadColor: leadEl ? getComputedStyle(leadEl).color : "",
        titleFontFamily: titleStyle.fontFamily,
        headingFontLoaded: document.fonts.check(`${titleStyle.fontWeight} ${titleStyle.fontSize} ${titleStyle.fontFamily.split(",")[0].replace(/["']/g, "")}`),
        typeBottomRatio: type.getBoundingClientRect().bottom / rect.height,
      };
    });

    if (probe.boxWidth !== COVER_CSS_WIDTH || probe.boxHeight !== COVER_CSS_HEIGHT) {
      throw new CoverError(
        `Cover box measured ${probe.boxWidth}x${probe.boxHeight}, expected ${COVER_CSS_WIDTH}x${COVER_CSS_HEIGHT}. ` +
          `templates/cover.css's fixed geometry is not holding — the output would not be 6x9.`,
      );
    }
    if (!probe.headingFontLoaded) {
      throw new CoverError(
        `The heading font did not load (computed family: ${probe.titleFontFamily}). The cover would render in a system fallback, violating R7/R10.`,
      );
    }

    const printPath = path.join(finalDir, `${options.projectSlug}-cover.print.png`);
    await page.locator(".cover").screenshot({ path: printPath });

    const outputs: CoverResult["outputs"] = [];
    for (const spec of specs) {
      if (spec === "print") {
        const meta = await sharp(printPath).withMetadata({ density: OUTPUT_SPECS.print.density }).toBuffer();
        await writeFile(printPath, meta);
        const size = readImageSize(await readFile(printPath), printPath)!;
        if (size.width !== OUTPUT_SPECS.print.width || size.height !== OUTPUT_SPECS.print.height) {
          throw new CoverError(`Print output is ${size.width}x${size.height}, expected ${OUTPUT_SPECS.print.width}x${OUTPUT_SPECS.print.height}.`);
        }
        outputs.push({ spec, path: printPath, width: size.width, height: size.height });
      } else {
        const kindlePath = path.join(finalDir, `${options.projectSlug}-cover.kindle.png`);
        await sharp(printPath)
          .resize(OUTPUT_SPECS.kindle.width, OUTPUT_SPECS.kindle.height, { fit: "cover", position: "attention" })
          .png()
          .toFile(kindlePath);
        outputs.push({ spec, path: kindlePath, width: OUTPUT_SPECS.kindle.width, height: OUTPUT_SPECS.kindle.height });
      }
    }

    return {
      projectRoot,
      coverHtmlPath,
      outputs,
      probe,
      artDpi: {
        artWidth: artSize.width,
        // The art is the only raster on the page; the type is live vector text.
        fullBleedDpi: Number((artSize.width / 6).toFixed(1)),
        printSpecRatio: Number((artSize.width / OUTPUT_SPECS.print.width).toFixed(3)),
      },
    };
  } finally {
    await browser.close();
  }
}
