---
name: chapter-layout
description: Use when running or supervising `/chapter <n>` (the layout-designer agent's job) — turning a chapter's markdown + its design/page-plan.json entry into html/<n>.html, applying the premium chapter anatomy and component insertion rules, and respecting visual density and page-break behavior.
---

# Chapter Layout

This skill governs how a chapter's markdown becomes premium book HTML. The
segmentation decision already happened in `src/plan/` — this skill is about
*applying* `design/page-plan.json`, never re-deciding it by eye, and about
how the resulting blocks are physically laid out on the page.

## Premium chapter anatomy

Every chapter opens the same disciplined way (`templates/chapter.html` +
`base.css` `.chapter-open`):

1. **Oversized number** — `.chapter-number`, 4.4em, light weight, in the
   accent color. Omit this whole element for Introduction/Conclusion — they
   have no number, don't fake one.
2. **Thin rule** — `.chapter-rule`, a 3em hairline under the number.
3. **Whitespace** — `padding-top: 12%` before any of this starts. The
   opener is not the place to economize space; the pause is the point.
4. **Drop cap** — the first paragraph's first letter, `::first-letter`
   targeting `.chapter-open .body-content > p:first-child`. This selector is
   load-bearing: never wrap that first paragraph in an extra element or
   prefix it with something that breaks the `:first-child` match, or the
   drop cap silently disappears.
5. **Rhythm** — after the opener, normal body rhythm takes over: justified,
   indented paragraphs, `h2`/`h3` with their own spacing scale
   (`--space-xl`/`--space-lg` before, `--space-md`/`--space-sm` after).

## Insertion rules — apply the plan's component enum

`design/page-plan.json` already assigned each block to one of:
`editorial-body`, `process-steps`, `checklist`, `comparison-table`,
`calculation-card`, `warning-callout`, `tip-callout`, `key-takeaways`,
`pull-quote` (`schemas/page-plan.schema.json`). This skill's job is turning
each assigned block into the matching partial from `templates/components/`
— not re-classifying content:

- **Criteria / requirement list** → `checklist.html` (real checkbox glyphs,
  never invented completion state — R3, don't imply anything's been checked).
- **Warning / caution content** → `warning-callout.html`.
- **Tip / encouragement content** → `tip-callout.html`.
- **Key idea / chapter-closing summary** → `key-takeaways.html`.
- **Pull quote** → `pull-quote.html`, **max 1 per chapter** (the plan's
  `minNonBodyComponents`/`actualNonBodyComponents` budget enforces this
  upstream — if a chapter's plan somehow carries two, that's a plan bug to
  fix in `src/plan/`, not something to work around here by picking one).

Every block's `preview` field in the plan holds the first ~80 characters of
the *source* text verbatim — use it to sanity-check you're rendering the
right block in the right order, and as a live reminder that R2 applies here
too: this skill assembles and formats, it never rewrites.

## Figures are not in the plan's enum — density governs them separately

Diagrams (`skills/infographics`) and ambient illustrations
(`skills/cover-design`'s sibling concern) aren't page-plan block types —
they're inserted by the infographic-designer agent against a chapter's
content, wrapped in `figure.figure` (`templates/components/figure.html`).
Budget: **roughly 1 visual per 2–3 pages** of chapter content. Too few and
the chapter reads as a wall of text; too many and visuals compete with each
other instead of supporting specific claims. Place each figure adjacent to
the block it illustrates, not batched at the end of the chapter.

## Never modifies text (R2)

The layout-designer's whole job is arrangement — components, spacing,
figure placement — never rewording. If a block's markdown looks awkward
once it's in a component (a checklist item that reads strangely as a short
imperative, say), that's a candidate for `reports/content-changes.md` with
the change logged, not a silent edit.

## Break control — never split a visual unit

`base.css` already sets `break-inside: avoid` on `figure`, `table`,
`.callout`, `.card`, `.pull-quote`, `.key-takeaways`, `.process-steps`, and
`.checklist`. Don't fight this with manual page-break overrides — if a
component is overflowing a page awkwardly, the fix is shortening the content
or moving the split point in the plan, not forcing a component to
straddle a page break.
