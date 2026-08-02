---
name: bonus-productizer
description: Use when running or supervising `/bonus-extract` (the bonus-productizer agent's job) — turning bonuses/raw/*.md content that pdf-ingest pulled out of the book body into standalone, branded deliverables (checklist PDF, fillable worksheet PDF, Notion template), each with a mini-cover and a displayed dollar value.
---

# Bonus Productizer

`skills/pdf-ingest` already pulled every `BONUS` block out of the chapter
body into `bonuses/raw/<bonus-slug>.md` (never left in `content/chapters/` —
see that skill and `src/qc/checks/no-bonus-in-body.ts`). This skill turns
each of those raw files into a deliverable worth bundling separately. The
guiding principle: **the ebook gets lighter, the offer gets richer.**
Reference material and tools don't belong in a reading experience — pulling
them out makes the book read tighter *and* makes the bundle look bigger.

Each raw bonus goes into `bonuses/<bonus-slug>/` and is matched to exactly
one of three deliverable formats based on what it actually is in the
source — don't force-fit a format the content doesn't match.

## Checklist → one-page branded PDF with checkboxes

For simple sequential/completion content ("do these N things"). Render as a
single page using `templates/components/checklist.html`'s markup
(`.checklist-box` — a real square via CSS border, not a rasterized icon)
inside a branded one-pager: the project's cover motif/palette in a header
band, the checklist body, the project's accent color for the checkbox
borders (`--color-checklist-box-border`) — everything through `tokens.css`,
same as the main book (R7 doesn't stop at the book's edge).

## Worksheet → fillable PDF (real form fields)

For content the reader is meant to write into (a planning template, a
tracking sheet). The bar here is **real AcroForm fields** — an actual
fillable PDF field the reader can click into and type in their PDF viewer,
not a visual box that only looks fillable. This matters because it's the
difference between "worksheet" and "picture of a worksheet."

**Known constraint:** Playwright's `page.pdf()` (what `src/render/` uses
for the book) does not carry HTML `<input>` elements through as PDF form
fields — printing to PDF flattens them to their visual rendering only. Real
fillable fields need a **post-process step** (e.g. `pdf-lib`, adding
AcroForm fields at specific coordinates after the base PDF is generated).
Whoever wires up worksheet rendering needs to build that step explicitly.
Until it exists, don't claim a worksheet is "fillable" if it's actually just
static ruled lines — say so plainly (R8: a claim of "fillable" is only true
once a command has actually produced a form field, not because it was
intended to).

## Notion template → structured markdown ready to import

For content that's naturally a living reference doc (a swipe file, a
resource database, a tracker meant to be edited long-term) rather than
something printed once. Structure the markdown the way Notion's importer
actually parses it, since the deliverable is the import, not the file:

- `#`/`##` headings become Notion page/heading blocks.
- `- [ ] task` (GitHub task-list syntax) becomes real Notion to-do blocks
  with working checkboxes — not `☐ task` as plain text.
- `>` blockquotes become Notion quote/callout blocks — useful for a "why
  this matters" note inline in the template.
- Plain `-`/`1.` lists become bulleted/numbered blocks as expected.

Ship a short companion "Import instructions" note alongside the markdown
file (where to paste it, that Notion's import preserves the block types
above) — the deliverable is only as good as the reader's ability to
actually get it into Notion.

## Every bonus gets a mini-cover + a displayed value

- **Mini-cover:** a smaller derivative of the book's own cover — same
  palette, motif, and type system (ask the art-director agent for it; see
  `skills/cover-design`), not an unrelated fresh concept. This is what makes
  the bundle read as one coherent product rather than a book plus loose
  extras.
- **Displayed value:** every bonus shows a concrete number — e.g. "$27
  value" — both in `templates/frontmatter/bonus-teaser.html` (the "Included
  with this book" page the reader sees *before* they've read anything, so
  the perceived value lands early) and on the bonus deliverable itself. R3
  still applies: the number should be a defensible standalone-product price
  a human assigned, never a fabricated statistic dressed up as one.

## Where this lives

`bonuses/raw/<bonus-slug>.md` (input, from ingest) →
`bonuses/<bonus-slug>/` (output: the finished deliverable + its mini-cover).
Each entry in `inventory.json`'s `bonuses[]` array (`id`, `title`, `file`,
page range, `wordCount`) is what this skill iterates over — never re-scan
the source PDF to find bonuses, that question was already answered at
ingest.
