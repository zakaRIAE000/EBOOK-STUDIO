---
name: cover-design
description: THE critical skill. Use when running or supervising `/cover` (the art-director agent's job) — writing differentiated cover concepts before generating anything, choosing US Kindle visual codes by niche, deciding whether title typography is baked into the Higgsfield image or composed as an HTML/SVG overlay, and producing covers at spec (Kindle thumbnail + 6x9 print + back cover + bonus mini-covers).
---

# Cover Design

This is the single highest-leverage visual decision in the whole pipeline —
readers judge a Kindle listing from a 100px-wide thumbnail before they read a
word of the sample. Everything here exists to survive that thumbnail.

## US Kindle visual codes by niche

These are the market-tested conventions US Kindle shoppers already pattern-match
on. Don't invent a fresh visual language per project — work inside the code
the niche's shelf already speaks, and differentiate through execution, not
through breaking the code.

- **Finance / trading:** dark background, gold/green accents, bold condensed
  type, an abstracted data motif (chart lines, candlesticks). Reads as
  "serious money," not playful.
- **Self-help:** light background, oversized type, **ONE** visual metaphor
  (a door, a path, a sunrise) — never stack two metaphors on one cover, it
  reads as indecisive rather than rich.
- **Business:** minimalism, strong contrast, generous negative space, one
  bold graphic idea. The restraint *is* the signal of competence.
- **Health / wellness:** clean, natural palette (greens, creams), calm. No
  clinical sterility and no juvenile brightness — calm sits between them.

## Production rule: where does the title live?

This decision comes before any prompt gets written, because it changes which
model generates the art:

- **Short title (≤4 words, no subtitle)** → generate the title *as part of
  the image* using Higgsfield's text-capable model (Nano Banana Pro). The
  typography becomes part of the composition itself.
- **Long title, or any subtitle** → generate background art **with no text
  at all**, then compose the typography as an HTML/SVG overlay rendered by
  our own render module (`src/render/`). Long strings baked into a
  diffusion-style image degrade fast — legibility and kerning control both
  suffer past a handful of words. Real title text as an overlay stays sharp,
  on-brand (uses the project's own `tokens.css` fonts and colors — R7), and
  is trivially re-editable if the human wants a wording tweak without a full
  regeneration.

This is a binary decision per cover, not a spectrum — pick one path and
commit before generating.

## Workflow

1. Write **3–4 differentiated concepts** before generating a single image.
   Each concept is a short written brief: **concept** (the one idea), **palette**
   (specific, not "warm tones" — name the hex family), **composition**
   (foreground/background/type placement), **model** (which Higgsfield model,
   and whether it's the text-capable one per the production rule above),
   **exact prompt** (the literal string that will be sent). Differentiated
   means genuinely different visual bets, not four crops of the same idea.
2. Present all 3–4 concepts to the human — this is the gate. The human
   picks one, or asks for a fifth direction.
3. Generate via the chosen provider (`src/providers/` — `ImageProvider`
   interface, Higgsfield implementation via MCP, R4: image-gen is for covers
   and ambient illustrations only, never diagrams). Every generation is
   logged to `cover/generation-log.json` (model, exact prompt, timestamp) —
   R8, the prompt that produced a given image is provable, not remembered.
4. Iterate on the chosen concept — palette tweaks, composition tweaks,
   regenerate — until the human signs off. Never silently swap to a
   different concept mid-iteration without flagging it.

## Specs

Every accepted cover produces, at minimum:

- **1600×2560px** — Kindle's storefront listing size.
- **6×9in at 300dpi** — the physical print cover used in the assembled PDF.
- **Back cover** — punchline + bullets + branding, composed against
  `templates/backmatter/back-cover.html` (`.back-cover` fills the content
  area using the project's `--color-primary`/`--color-bg` — R7, no
  hardcoded cover colors bleeding into the template).
- **Bonus mini-covers** — see `skills/bonus-productizer`: each bonus
  deliverable gets a smaller cover derived from these same assets (palette,
  motif, type system), not a fresh unrelated concept.

## The thumbnail test

Before a concept is considered done: shrink it to **100px wide** (a
realistic Kindle browse-grid thumbnail) and check whether the title is still
readable. If it isn't, the concept fails — full stop, regardless of how good
it looks at full size. This is the cheapest, highest-signal check available
and should be run on every candidate before it's presented to the human, not
just on the final pick.
