import { mkdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Ajv } from "ajv";
import projectConfigSchema from "../../schemas/project-config.schema.json" with { type: "json" };

export class DesignError extends Error {}

// --- Public types -------------------------------------------------------

export interface DesignOptions {
  projectSlug: string;
  /** Defaults to workspace/projects relative to the repo root. */
  projectsRoot?: string;
  /** Defaults to process.cwd(); the repo root holding config/, themes/, templates/, brand/. */
  repoRoot?: string;
}

export interface ProjectConfig {
  schemaVersion: 1;
  project: {
    slug: string;
    title: string;
    subtitle: string | null;
    author: string;
    niche: string;
    targetReader: string;
    tone: string;
  };
  language: "en-US";
  format: {
    pageWidth: string;
    pageHeight: string;
    marginOuter: string;
    marginInner: string;
    marginTop: string;
    marginBottom: string;
  };
  disclaimer: { required: boolean; text: string | null };
  /**
   * Back-matter copy. All optional: the CTA and back cover are composed only
   * when the project actually supplies their words. Nothing here can be
   * generated — a punchline or an offer written by the pipeline would be a
   * claim the author never made (R3), so an absent field means the section is
   * skipped, never filled with placeholder prose.
   */
  backMatter: {
    ctaTitle: string | null;
    ctaContent: string | null;
    /** Optional external destination. Omitted entirely for a self-contained book. */
    ctaLink: string | null;
    ctaLinkLabel: string | null;
    backCoverPunchline: string | null;
    /** Blank-line separated in brand-input.md, so a bullet may itself contain a dash. */
    backCoverBullets: string[];
  };
  theme: { name: string };
  fonts: { body: string; heading: string; mono: string };
  palette: {
    bg: string; bgAlt: string; text: string; textMuted: string; heading: string;
    primary: string; secondary: string; accent: string; border: string; rule: string; link: string;
    /** Negative/stop hue. Optional in brand-input.md; no other palette entry can substitute for it. */
    danger: string;
  };
}

export interface DesignResult {
  config: ProjectConfig;
  projectRoot: string;
  brandInputPath: string;
  brandInputJustCreated: boolean;
  generatedPath: string;
  userPath: string;
  resolvedPath: string;
  tokensCssPath: string;
}

// --- config/defaults.yaml -------------------------------------------------

interface Defaults {
  schemaVersion: 1;
  language: string;
  format: ProjectConfig["format"];
  theme: string;
  disclaimerRequiredNiches: string[];
}

interface ThemePreset {
  name: string;
  fonts: { body: string; heading: string; mono: string };
  palette: ProjectConfig["palette"];
}

async function loadDefaults(repoRoot: string): Promise<Defaults> {
  const raw = await readFile(path.join(repoRoot, "config", "defaults.yaml"), "utf-8");
  return parseYaml(raw) as Defaults;
}

async function loadTheme(repoRoot: string, themeName: string): Promise<ThemePreset> {
  const themePath = path.join(repoRoot, "themes", themeName, "tokens.json");
  let raw: string;
  try {
    raw = await readFile(themePath, "utf-8");
  } catch {
    throw new DesignError(`Theme "${themeName}" not found at ${themePath}.`);
  }
  return JSON.parse(raw) as ThemePreset;
}

// --- brand-input.md: ensure present, parse fields -------------------------

const FIELD_LABEL_MAP: Record<string, string> = {
  "niche": "niche",
  "book title": "title",
  "subtitle": "subtitle",
  "author / brand name": "author",
  "target reader": "targetReader",
  "tone": "tone",
  "disclaimer": "disclaimer",
  "primary": "primary",
  "secondary": "secondary",
  "accent": "accent",
  "background": "background",
  "text": "text",
  "background alt": "backgroundAlt",
  "text muted": "textMuted",
  "heading": "headingColor",
  "border": "border",
  "rule": "rule",
  "link": "link",
  "danger": "danger",
  "cta title": "ctaTitle",
  "cta body": "ctaContent",
  "cta link": "ctaLink",
  "cta link label": "ctaLinkLabel",
  "back cover punchline": "backCoverPunchline",
  "back cover bullets": "backCoverBullets",
  "body font": "fontBody",
  "heading font": "fontHeading",
  "mono font": "fontMono",
};

const FIELD_START_RE = /^\*\*([^*:]+):\*\*\s*(.*)$/;

async function ensureBrandInputFile(
  projectRoot: string,
  repoRoot: string,
): Promise<{ path: string; justCreated: boolean }> {
  const brandInputPath = path.join(projectRoot, "brand-input.md");
  try {
    await stat(brandInputPath);
    return { path: brandInputPath, justCreated: false };
  } catch {
    const templatePath = path.join(repoRoot, "brand", "brand-input.template.md");
    await copyFile(templatePath, brandInputPath);
    return { path: brandInputPath, justCreated: true };
  }
}

/** Sentinel pushed into the line buffer where a blank line separated two paragraphs. */
const PARAGRAPH_BREAK = "\n\n";

/** Parses the brand-input.md form into a flat field map, keyed by FIELD_LABEL_MAP values. */
function parseBrandInput(markdown: string): Record<string, string> {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lines = withoutComments.split(/\r?\n/);
  const fields: Record<string, string> = {};

  let currentKey: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentKey) {
      // Lines inside a paragraph rejoin with a space; PARAGRAPH_BREAK markers survive as
      // real blank lines, so a multi-paragraph field keeps its structure.
      fields[currentKey] = buffer.join(" ").replace(/\s*\n\n\s*/g, "\n\n").trim();
    }
    currentKey = null;
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(FIELD_START_RE);
    if (match) {
      flush();
      const label = match[1].replace(/\s*\((required|optional)\)\s*$/i, "").trim().toLowerCase();
      const key = FIELD_LABEL_MAP[label];
      if (key) {
        currentKey = key;
        buffer = match[2] ? [match[2].trim()] : [];
      }
      continue;
    }
    if (!currentKey) continue;
    // A markdown heading or rule genuinely ends the field. A blank line does NOT — a
    // real disclaimer runs several paragraphs, and flushing on the first blank line
    // silently truncated it to its opening sentence. The next `**Field:**` marker,
    // heading, or `---` closes the field instead.
    if (line.startsWith("#") || line.startsWith("---")) {
      flush();
      continue;
    }
    if (line === "") {
      if (buffer.length > 0 && buffer[buffer.length - 1] !== PARAGRAPH_BREAK) buffer.push(PARAGRAPH_BREAK);
      continue;
    }
    buffer.push(line);
  }
  flush();

  return fields;
}

// --- Merge chain: defaults -> theme preset -> generated -> user -> resolved

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function fontStack(family: string, role: "body" | "heading" | "mono"): string {
  const fallback =
    role === "body" ? `Georgia, "Times New Roman", serif` : role === "heading" ? `"Helvetica Neue", Arial, sans-serif` : `"Courier New", monospace`;
  return `"${family}", ${fallback}`;
}

function buildResolvedConfig(
  slug: string,
  defaults: Defaults,
  theme: ThemePreset,
  disclaimerRequired: boolean,
  fields: Record<string, string>,
): ProjectConfig {
  const required = ["niche", "title", "author", "targetReader", "tone", "primary", "secondary", "accent", "background", "text"];
  const missing = required.filter((key) => !fields[key]);
  if (disclaimerRequired && !fields.disclaimer) missing.push("disclaimer");

  if (missing.length > 0) {
    throw new DesignError(
      `brand-input.md is missing required field(s): ${missing.join(", ")}. Fill them in and re-run studio:design.`,
    );
  }

  return {
    schemaVersion: 1,
    project: {
      slug,
      title: fields.title,
      subtitle: fields.subtitle || null,
      author: fields.author,
      niche: fields.niche,
      targetReader: fields.targetReader,
      tone: fields.tone,
    },
    language: "en-US",
    format: { ...defaults.format },
    disclaimer: { required: disclaimerRequired, text: fields.disclaimer || null },
    backMatter: {
      ctaTitle: fields.ctaTitle || null,
      ctaContent: fields.ctaContent || null,
      ctaLink: fields.ctaLink || null,
      ctaLinkLabel: fields.ctaLinkLabel || null,
      backCoverPunchline: fields.backCoverPunchline || null,
      // Blank-line separated in the form, so a bullet containing its own dash
      // stays intact — splitting on "-" would break exactly that case.
      backCoverBullets: (fields.backCoverBullets || "")
        .split(/\n\n+/)
        .map((b) => b.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean),
    },
    theme: { name: theme.name },
    fonts: {
      body: fields.fontBody || theme.fonts.body,
      heading: fields.fontHeading || theme.fonts.heading,
      mono: fields.fontMono || theme.fonts.mono,
    },
    palette: {
      bg: normalizeHex(fields.background),
      bgAlt: fields.backgroundAlt ? normalizeHex(fields.backgroundAlt) : theme.palette.bgAlt,
      text: normalizeHex(fields.text),
      textMuted: fields.textMuted ? normalizeHex(fields.textMuted) : theme.palette.textMuted,
      heading: fields.headingColor ? normalizeHex(fields.headingColor) : theme.palette.heading,
      primary: normalizeHex(fields.primary),
      secondary: normalizeHex(fields.secondary),
      accent: normalizeHex(fields.accent),
      border: fields.border ? normalizeHex(fields.border) : theme.palette.border,
      rule: fields.rule ? normalizeHex(fields.rule) : theme.palette.rule,
      link: fields.link ? normalizeHex(fields.link) : theme.palette.link,
      danger: fields.danger ? normalizeHex(fields.danger) : theme.palette.danger,
    },
  };
}

// --- tokens.css instantiation ----------------------------------------------

const TOKEN_CSS_VAR_BY_PALETTE_KEY: Record<keyof ProjectConfig["palette"], string> = {
  bg: "color-bg",
  bgAlt: "color-bg-alt",
  text: "color-text",
  textMuted: "color-text-muted",
  heading: "color-heading",
  primary: "color-primary",
  secondary: "color-secondary",
  accent: "color-accent",
  border: "color-border",
  rule: "color-rule",
  link: "color-link",
  danger: "color-danger",
};

function setCssVar(css: string, varName: string, value: string): string {
  const re = new RegExp(`(--${varName}:\\s*)[^;]+;`);
  if (!re.test(css)) {
    throw new DesignError(`templates/tokens.template.css has no "--${varName}" declaration to instantiate.`);
  }
  return css.replace(re, (_m, prefix: string) => `${prefix}${value};`);
}

function instantiateTokensCss(templateCss: string, config: ProjectConfig): string {
  let css = templateCss;
  for (const [paletteKey, varName] of Object.entries(TOKEN_CSS_VAR_BY_PALETTE_KEY) as [
    keyof ProjectConfig["palette"],
    string,
  ][]) {
    css = setCssVar(css, varName, config.palette[paletteKey]);
  }
  css = setCssVar(css, "font-body", fontStack(config.fonts.body, "body"));
  css = setCssVar(css, "font-heading", fontStack(config.fonts.heading, "heading"));
  css = setCssVar(css, "font-mono", fontStack(config.fonts.mono, "mono"));
  return css;
}

// --- Orchestration -----------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
const validateConfig = ajv.compile(projectConfigSchema);

function resolveProjectRoot(options: DesignOptions): { projectRoot: string; repoRoot: string } {
  const repoRoot = options.repoRoot ?? process.cwd();
  const projectsRoot = options.projectsRoot ?? path.resolve(repoRoot, "workspace/projects");
  return { projectRoot: path.join(projectsRoot, options.projectSlug), repoRoot };
}

export async function designProject(options: DesignOptions): Promise<DesignResult> {
  const { projectRoot, repoRoot } = resolveProjectRoot(options);

  const defaults = await loadDefaults(repoRoot);
  const theme = await loadTheme(repoRoot, defaults.theme);

  const { path: brandInputPath, justCreated } = await ensureBrandInputFile(projectRoot, repoRoot);
  const brandInputMarkdown = await readFile(brandInputPath, "utf-8");
  const fields = parseBrandInput(brandInputMarkdown);

  const disclaimerRequired = defaults.disclaimerRequiredNiches.some((n) =>
    (fields.niche ?? "").toLowerCase().includes(n.toLowerCase()),
  );

  const configDir = path.join(projectRoot, "config");
  const designDir = path.join(projectRoot, "design");
  await mkdir(configDir, { recursive: true });
  await mkdir(designDir, { recursive: true });

  const generatedPath = path.join(configDir, "generated.yaml");
  await writeFile(generatedPath, stringifyYaml({ schemaVersion: 1, disclaimerRequired }), "utf-8");

  const userPath = path.join(configDir, "user.yaml");
  await writeFile(userPath, stringifyYaml({ schemaVersion: 1, ...fields }), "utf-8");

  if (justCreated) {
    throw new DesignError(
      `No brand-input.md found for "${options.projectSlug}" — copied the blank form to ${brandInputPath}. Fill it in and re-run studio:design.`,
    );
  }

  const config = buildResolvedConfig(options.projectSlug, defaults, theme, disclaimerRequired, fields);

  if (!validateConfig(config)) {
    throw new DesignError(`Resolved config failed schema validation: ${ajv.errorsText(validateConfig.errors)}`);
  }

  const resolvedPath = path.join(configDir, "resolved.yaml");
  await writeFile(resolvedPath, stringifyYaml(config), "utf-8");

  const templateCss = await readFile(path.join(repoRoot, "templates", "tokens.template.css"), "utf-8");
  const tokensCss = instantiateTokensCss(templateCss, config);
  const tokensCssPath = path.join(designDir, "tokens.css");
  await writeFile(tokensCssPath, tokensCss, "utf-8");

  return {
    config,
    projectRoot,
    brandInputPath,
    brandInputJustCreated: justCreated,
    generatedPath,
    userPath,
    resolvedPath,
    tokensCssPath,
  };
}
