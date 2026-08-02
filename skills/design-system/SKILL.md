---
name: design-system
description: Use when running or supervising `npm run studio:design` (the layout-designer agent's job) — turning a filled brand-input.md into a project's design/tokens.css, choosing a font pairing for the book's niche, computing the type scale and WCAG contrast, and producing the one-page sample PDF for the human design gate.
---

# Design System

`brand-input.md` in, `design/tokens.css` out. This skill is what makes a
finance ebook read authoritative and a self-help ebook read warm without a
single line of `src/` changing — niche lives in config, never in code.

## Font pairing by niche

The vendored trio is Literata (serif, body), Inter (sans, headings/UI), and
JetBrains Mono (figures/code) — OFL, in `assets/fonts/` (R10). **This is
currently the only supported font set** — `brand-input.md`'s font fields
fall back to this trio when left blank, and any font named there that isn't
one of these three has no `@font-face` to render with yet. Niche personality
comes from *how* this trio is tuned (weight, tracking, line-height, scale
ratio, palette), not from swapping in new families, with one exception noted
below.

| Niche | Body | Headings | Personality knobs |
|---|---|---|---|
| Finance / trading / business | Literata | Inter | Tight tracking (`--letter-spacing-heading` toward 0.01em, not the airy default), heavier heading weight (`--weight-heading` at 700, not the lighter 500 variant), tighter modular scale ratio (~1.25) for restrained size jumps. Reads as authority, not decoration. |
| Self-help | Literata (see note) | Inter | Generous line-height (`--line-height-body` up to 1.65–1.75 vs. the 1.55 default), airier modular scale ratio (~1.3–1.333), lighter heading weight (500) for warmth over authority. |
| Health / wellness | Literata | Inter | Light and airy: lighter body weight where the design allows, generous whitespace (bump `--space-lg`/`--space-xl`), softer accent — steer the palette toward calm greens/creams (see `brand-input.md`'s palette fields) rather than the bold gold/black default theme. High whitespace matters more here than type tricks. |
| Tech / how-to | Literata | Inter for headings, **JetBrains Mono for any code, commands, or figures** | Modern sans-forward headings, monospace wherever the source has literal commands/code/config — never fake code voice with italics on the body font. |

**Note on self-help body font:** the ideal pairing here is Source Serif 4 or
Literata — Source Serif 4 is not vendored (R10 restricts to the trio above).
Use Literata; its generous readability and warmth cover the brief. If a
specific project's brand genuinely needs Source Serif 4, that's a call for
the human at the design gate — vendoring an additional OFL font is a
one-time `assets/fonts/` addition, not something this skill does silently.

## WCAG contrast — computed, not eyeballed

Every resolved palette (`schemas/project-config.schema.json`'s `palette`
object) must clear:

- Body text (`--color-text` on `--color-bg`, and anywhere `--font-size-body`
  is used): **≥4.5:1** (WCAG AA, normal text).
- Large headings (`--font-size-h1`/`--font-size-h2`, both well past the
  18.66pt/24px-bold WCAG "large text" threshold): **≥3:1** minimum.

Compute this with the actual relative-luminance contrast formula against the
brand's hex values from `brand-input.md`, not by eye. This is the design
gate's own check, running *before* the full pipeline reaches
`src/qc/checks/contrast.ts` (which enforces the same ≥4.5:1 body floor later
as a QC gate) — catching a bad palette here means it never has to bounce
back from QC after a full chapter build.

## Modular type scale

Base is `--font-size-body: 11pt`. Pick a ratio in the 1.25–1.333 range and
derive the heading sizes from it (each level = previous level × ratio,
rounded to a sane pt value):

- **Tighter (~1.25, "major third")** for niches wanting restraint and
  authority (finance, trading, business) — headings feel deliberate, not
  loud.
- **Airier (~1.3–1.333, "perfect fourth")** for niches wanting warmth or
  breathing room (self-help, health/wellness) — more dramatic jumps between
  body and heading make the page feel less dense.

The engine's current defaults (`--font-size-h1: 30pt`, `--font-size-h2: 17pt`,
`--font-size-h3: 13pt` off an 11pt base) sit close to a ~1.3 ratio applied
twice from h3 down to body, with h1 pushed further for a strong chapter
opener — use that as the reference point when tuning per niche rather than
inventing sizes from scratch.

## Always produce the one-page sample

Never hand a project's full `tokens.css` to the human gate without a
rendered one-page sample showing it in context — h1 through h3, a body
paragraph with the drop cap, one callout, one table. This is the "Valider
tokens + page d'échantillon" gate in the pipeline table: the human is
judging a real page, not a list of hex codes and font names. Regenerate the
sample any time `brand-input.md` changes and `studio:design` re-runs — never
let the human-approved sample drift out of sync with what `tokens.css`
actually contains.

## Where values actually live

`config/defaults.yaml` → theme preset (`themes/<name>/tokens.json`) →
`config/generated.yaml` (niche-derived, e.g. disclaimer requirement) →
`config/user.yaml` (parsed `brand-input.md`) → `config/resolved.yaml`
(validated against `schemas/project-config.schema.json`). Only the primitive
`color-*` and `font-*` values in `tokens.template.css` get rewritten per
project — every other token in that file is a derived `var()` alias and
rides along for free. Never hand-edit a project's generated `tokens.css`
directly; edit `brand-input.md` (or the theme) and re-run `studio:design`.
