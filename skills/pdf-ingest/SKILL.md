---
name: pdf-ingest
description: Use when running or supervising `npm run studio:ingest` (the extractor agent's job) — extracting a source.pdf's text layer into per-chapter markdown, naming chapter files, routing BONUS sections out of the book body, and validating the resulting inventory.json before anyone downstream reads it.
---

# PDF Ingest

Ingest is the only place `source.pdf` is ever opened. Everything after this
skill — plan, design, layout, QC — reads `content/chapters/*.md`,
`bonuses/raw/*.md`, and `inventory.json`. Never the PDF itself (R9). Get this
step right and every later agent can trust it without re-checking.

## What gets extracted

- **Text layer only.** Pull text runs via pdfjs-dist, group into lines by Y
  coordinate, detect columns (tables) by X-gap, reconstruct paragraphs/lists/
  tables as markdown. Nothing here touches pixels.
- **Source images are always ignored.** Synthesise AI output PDFs carry no
  meaningful figures worth keeping — any imagery in the source is a basic-layout
  artifact, not content. Never extract, embed, or reference an image from
  `source.pdf` anywhere downstream. All visuals in the final book are either
  deterministic SVG (`skills/infographics`) or Higgsfield-generated art
  (`skills/cover-design`), both produced fresh, never lifted from the source.
- **Text is preserved verbatim (R2).** Only fix broken characters, encoding
  artifacts, and grammar-level slips — and log every one in
  `reports/content-changes.md`. Never rewrite, summarize, or improve prose.

## Chapter naming

Detected structure maps to filenames like this:

| Detected | `type` | `number` | File |
|---|---|---|---|
| "Introduction" | `introduction` | `null` | `content/chapters/00-introduction.md` |
| "CHAPTER 01" … "CHAPTER NN" | `chapter` | `1..N` | `content/chapters/01-<slug>.md` … `NN-<slug>.md` |
| "Conclusion" | `conclusion` | `null` | `content/chapters/NN-conclusion.md` (NN = last chapter number + 1, zero-padded) |
| No markers found | `unclassified` | `null` | `content/chapters/00-full-source.md` (fallback — the whole source in one file) |

`<slug>` is a kebab-case derivation of the detected chapter title (e.g. "Cold
Outreach Basics" → `cold-outreach-basics`). Numbers are zero-padded to at
least 2 digits so filenames sort correctly regardless of chapter count.

## BONUS sections leave the body at ingest

Anything detected as a `BONUS` block (Synthesise AI's marker for checklists,
worksheets, swipe files, templates bundled at the end of a chapter or the
book) is written to `bonuses/raw/<bonus-slug>.md`, recorded in `inventory.json`'s
`bonuses` array, and is **never** written into `content/chapters/`. This
isn't a later cleanup step — the body should never contain bonus content in
the first place, which is why `src/qc/checks/no-bonus-in-body.ts` exists as a
backstop, not the primary mechanism. `skills/bonus-productizer` picks these
raw files up later and turns them into standalone deliverables.

## `inventory.json` is the single source of truth

Every agent downstream reads `inventory.json`, never the PDF, never a
directory listing (R9). It must conform to `schemas/inventory.schema.json`.
Key shape:

- `sourceSha256` — SHA-256 of the untouched `source.pdf` bytes. This is the
  proof R1 held: the source was read, never edited.
- `fallbackUsed` — `true` only when no chapter/bonus markers were detected at
  all and the whole source became one `unclassified` file. This must also
  produce a `warnings` entry explaining why.
- `chapters[]` — `{ id, type, number, title, file, startPage, endPage, wordCount }`.
- `bonuses[]` — `{ id, title, file, startPage, endPage, wordCount }`.
- `warnings[]` — anything a human should double-check at the ingest gate
  (ambiguous chapter boundary, a title that looked like a false-positive
  marker, a page that yielded suspiciously little text).

## Sanity checks before the human gate

Before handing `inventory.json` to the human for the "validate chapter +
bonus split" gate, verify:

1. `schemaVersion` is `1` and the file validates against
   `schemas/inventory.schema.json` (ajv) — don't hand-wave this, run it.
2. `sourceSha256` matches a fresh hash of `source/original.pdf` on disk right
   now — proves nothing touched the source between extraction and this check.
3. `pageCount` matches the PDF's real page count.
4. Every `file` path in `chapters[]` and `bonuses[]` exists on disk and is
   non-empty.
5. Chapters are sorted by `startPage` ascending with no overlapping page
   ranges, and no duplicate `id` across `chapters[]` + `bonuses[]` combined.
6. If `fallbackUsed` is `true`, `chapters` contains exactly one
   `unclassified` entry and `warnings` explains why detection failed —
   never leave a human guessing why there's only one file.
7. `wordCount` is plausible for the page range (a near-zero count on a
   multi-page chapter means extraction silently failed on that section —
   surface it as a warning, don't let it pass quietly).

A failed sanity check is a reason to fix the ingest logic or the detection
patterns, not a reason to hand-edit `inventory.json` — it's supposed to be
the trustworthy record of what actually happened.
