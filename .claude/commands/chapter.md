---
description: Lay out one chapter (markdown + page-plan -> html), insert diagrams, render a preview PDF, and validate with a human.
argument-hint: <slug> <n>
allowed-tools: Agent, Bash, Read
---

# /chapter — Step 4/7

`$ARGUMENTS` is `<slug> <n>` — the project slug and the chapter number (or `intro`/`conclusion`) to lay out. Requires `/cover` to have completed and `design/page-plan.json` to exist (produced by `npm run studio:plan -- --project <slug>`, run this first if it's missing).

## Steps

1. Invoke the **layout-designer** agent (Job 2 — chapter layout) with the project slug and chapter number. It reads only that chapter's markdown and its `page-plan.json` entry (R9), applies the plan's block→component assignments per `skills/chapter-layout/SKILL.md`, and writes `html/<n>.html`.
2. Wherever the layout-designer identifies a diagram opportunity, it hands a visual brief to the **infographic-designer** agent, which produces a deterministic inline SVG per `skills/infographics/SKILL.md` (never image-gen — R4) inside the `figure.figure` wrapper.
3. The layout-designer renders a preview PDF (and PNGs) for this chapter via `npm run studio:prototype -- --project <slug> --html html/<n>.html --css design/tokens.css templates/base.css --previews`.

## Validation gate (human, required)

**"Preview PDF is at `<path>` — OK, or retouches?"**

If retouches are requested, re-invoke the relevant agent (layout-designer for arrangement/components, infographic-designer for a diagram) — never hand-edit the rendered HTML outside an agent, and never let either agent touch the chapter's source text (R2).

Repeat `/chapter $ARGUMENTS` for every remaining chapter before moving to `/bonus-extract`.
