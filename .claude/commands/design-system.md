---
description: Turn a project's brand-input.md into design/tokens.css + a one-page sample, and validate it with a human.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /design-system — Step 2/7

`$ARGUMENTS` is the project slug. Requires `/ingest` to have completed for this project (an `inventory.json` should already exist — this step doesn't need it directly, but it's the expected pipeline order).

## Steps

1. Invoke the **layout-designer** agent (Job 1 — design system) with the project slug.
2. If `brand-input.md` doesn't exist yet, the agent will create it from `brand/brand-input.template.md` via `npm run studio:design -- --project $ARGUMENTS` and stop — tell the human to fill in the required fields (niche, title, author, target reader, tone, palette, and disclaimer if the niche requires one) and re-run `/design-system $ARGUMENTS`.
3. Once filled, the agent resolves `config/resolved.yaml` and `design/tokens.css`, checks WCAG contrast against `skills/design-system/SKILL.md`'s floors, and renders a one-page sample PDF via `npm run studio:prototype`.

## Validation gate (human, required)

The layout-designer agent ends with the resolved palette/fonts summary and the sample PDF path, then asks: **"Do the tokens and sample page look right?"**

Do not proceed to `/cover` until the human explicitly confirms. If they want changes, they edit `brand-input.md` (never `tokens.css` directly) and you re-invoke `/design-system $ARGUMENTS`.
