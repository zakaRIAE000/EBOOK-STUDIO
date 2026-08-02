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

## Fonts — optional

<!-- Leave blank for the pipeline default (Literata body / Inter heading /
     JetBrains Mono figures). OFL only (R10) — the vendored trio in
     assets/fonts/ is currently the only supported set. -->

**Body font:** 
**Heading font:** 
**Mono font:** 
