# Brand Input

Fill in every field below, save this file, then run:

```
npm run studio:design -- --project <slug>
```

Fields marked (required) must be filled before `design/tokens.css` can be
generated. Everything else falls back to a neutral default (from
`config/defaults.yaml` or the theme) if left blank. This file is never
overwritten by the pipeline once it exists — edit it freely and re-run
`studio:design` as many times as you like.

---

**Niche (required):** 
<!-- e.g. finance, trading, self-help, business, health, wellness, tech-how-to.
     Drives the disclaimer requirement below (finance/trading/health = mandatory). -->

**Book title (required):** 

**Subtitle:** 

**Author / brand name (required):** 

**Target reader (required):** 
<!-- one or two sentences: who is this book for -->

**Tone (required):** 
<!-- e.g. authoritative, warm, energetic, calm -->

**Disclaimer:** 
<!-- Required by the pipeline for finance/trading/health niches (US market
     norm for that content). Leave blank for other niches unless you want one
     anyway. If required and left blank, studio:design will refuse to
     generate the resolved config until you fill it in. -->

---

## Color palette — required (hex, e.g. #14120f)

**Primary:** 
**Secondary:** 
**Accent:** 
**Background:** 
**Text:** 

## Color palette — optional (hex; blank = falls back to the theme default)

**Background alt:** 
**Text muted:** 
**Heading:** 
**Border:** 
**Rule:** 
**Link:** 
**Danger:** 
<!-- Danger = the negative/stop hue, used by status components and by any
     diagram built on a success/caution/stop metaphor. Unlike success and
     warning (which alias onto Secondary and Accent), this has no stand-in
     in the palette above, so leaving it blank falls back to the theme's
     red rather than to one of your brand hues. Set it if your brand has a
     specific red; otherwise the default is fine. -->

## Back matter — optional (but a finished book wants both)

<!-- The CTA page and the back cover are composed ONLY when you write them
     here. The pipeline will never generate a punchline or an offer: that
     would be a claim you never made (R3). Leave these blank and both
     sections are skipped, and studio:build reports the omission.

     CTA link is optional too — omit it for a self-contained book with no
     external destination, and the button is dropped rather than rendered
     pointing nowhere. -->

**CTA title:** 
**CTA body:** 
**CTA link:** 
**CTA link label:** 

**Back cover punchline:** 

<!-- Back cover bullets: three of them, separated by a BLANK LINE each (not
     consecutive "-" lines). Blank-line separation is what lets a bullet
     contain its own dash without being split in half. A leading "- " is
     optional and stripped. Never state a claim the book does not support (R3). -->

**Back cover bullets:** 

<!-- The back cover's branding line is not a field: it uses the Author /
     brand name you already gave above. -->

## Fonts — optional

<!-- Leave blank for the pipeline default (Literata body / Inter heading /
     JetBrains Mono figures). OFL only (R10) — the vendored trio in
     assets/fonts/ is currently the only supported set. -->

**Body font:** 
**Heading font:** 
**Mono font:** 
