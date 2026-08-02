---
name: pdf-assembly
description: Use when running or supervising `/assemble` (the final composition step, ahead of `studio:build`) — ordering every section into the final PDF, wiring front-matter/body pagination, PDF metadata, and the pre-export checklist to run before handing the assembled book to `/qa`.
---

# PDF Assembly

This is where every previously-approved piece (cover, front matter, every
validated chapter, bonus teaser, back matter) becomes one document in the
canonical order. Assembly composes; `/qa` (`skills` none — it runs
`studio:qc` directly) proves. Don't skip straight to QC without walking this
checklist first — a QC failure here is usually a composition mistake, not a
content one.

## Canonical order

```
cover → title page → copyright + disclaimer → bonus teaser
  → table of contents → chapters (in inventory order) → CTA → back cover
```

Maps directly to `templates/`:

1. Cover — from `skills/cover-design`'s output, the 6×9in/300dpi print
   version (not the Kindle 1600×2560 listing image).
2. `frontmatter/title-page.html` — deliberately has no `break-before: page`
   in `base.css` (it's always page 1; forcing a break before it produced a
   spurious blank page ahead of it, since Paged.js counts the zero-footprint
   `.doc-title-marker` sibling as occupying page 1 already).
3. `frontmatter/copyright.html` — includes the `{{NICHE_DISCLAIMER}}` block
   whenever `config/resolved.yaml`'s `disclaimer.required` is `true`
   (`config/defaults.yaml`'s `disclaimerRequiredNiches`: finance, trading,
   investing, health, wellness, medical). If required and the resolved
   config has no disclaimer text, that's a block on assembly, not something
   to paper over with a generic placeholder.
4. `frontmatter/bonus-teaser.html` — only if `inventory.json.bonuses` is
   non-empty.
5. `frontmatter/toc.html` — built last among front matter, since its entries
   need every chapter/bonus/backmatter section's final `id` to exist before
   `target-counter()` can resolve page numbers against them.
6. Chapters, in `inventory.json`'s chapter order — each already validated
   individually at its own `/chapter <n>` gate. Assembly doesn't re-decide
   layout, it concatenates what was already approved.
7. `backmatter/cta.html`.
8. `backmatter/back-cover.html` — `page: back-cover` in `base.css` strips the
   running header/folio entirely; this page is the one place in the interior
   PDF that intentionally has neither.

## Roman numerals for front matter, arabic for the body

**This is not wired up yet in `base.css` today** — `@page :left`/`:right`
currently print a single continuous `counter(page)` in the same format for
every page, front matter included. True book convention needs two things
added before this can be signed off:

1. A `counter-reset: page 1` at the first `.chapter-open` page, so the body
   restarts at arabic `1` regardless of how many front-matter pages preceded
   it.
2. Front-matter folios rendered with `content: counter(page, lower-roman)`
   scoped to pages *before* that reset (title page through TOC), switching
   to the existing `content: counter(page)` (arabic) from the first chapter
   page onward.

Don't assume this exists because it's "obviously how books work" — verify it
against `base.css` before checking it off the pre-export checklist below,
and implement it if it's still missing.

## TOC via native `target-counter` — already correct, don't hand-roll it

`base.css`'s `.toc-pagenum::after { content: target-counter(attr(data-target), page) }`
resolves page numbers from the single Paged.js pagination pass that already
built the final page tree — no second render pass, no manually-typed page
numbers. The one rule that matters for assembly: every `href`/`data-target`
in `toc.html`'s entries must match the `id` on that section's actual wrapper
element **exactly** (`.chapter-open#ch-01`, a bonus section's id, etc.) —
`src/qc/checks/outline-toc.ts` is the backstop, but a typo'd id here is a
composition bug, not a QC surprise.

## PDF metadata

Title, author, and `lang=en-US` (single output language, no exceptions) get
set on the document as real PDF/XMP metadata, not just visible text on the
title page — `src/qc/checks/metadata.ts` checks the actual metadata fields,
not what's printed on page 1.

## Pre-export checklist

Before calling assembly done and handing off to `/qa`:

- [ ] Every chapter in `inventory.json` has a corresponding assembled
      `.chapter-open` section, in the right order (structure check).
- [ ] Zero `BONUS` content remains in any chapter body (no-bonus-in-body
      check) — should already be true from ingest, but verify on the
      assembled document, not just the source markdown.
- [ ] Every TOC `data-target` resolves to a real id in the assembled
      document (outline-toc check).
- [ ] Document metadata set: title, author, `lang=en-US` (metadata check).
- [ ] Disclaimer block present if the niche requires it (see step 3 above).
- [ ] Cover assets exist at both specs: 1600×2560px Kindle PNG and 6×9in
      300dpi print (assets-exist / image-dpi checks).
- [ ] Assembled file size is sane before export (file-size check, <15MB) —
      catching a runaway embedded asset now is cheaper than after a full
      `studio:build`.

Every box above corresponds to a real `src/qc/checks/*.ts` gate — this
checklist exists so assembly catches its own mistakes before `/qa` has to,
not as a duplicate paper trail. Nothing here is complete because it "looks
right" — it's complete when the corresponding command has actually run and
its exit code says so (R8).
