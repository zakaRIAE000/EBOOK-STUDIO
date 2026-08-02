# Vendored fonts (R10 — OFL only)

Variable fonts, sourced from the [Google Fonts repo](https://github.com/google/fonts) (`ofl/`), each with its own `OFL.txt` license alongside the font files. Each family ships one upright and one italic variable font file; weight is selected at render time via `font-weight` (the `wght` axis) and, for Literata/Inter, optical size rides along automatically via the `opsz` axis.

| Family | Role | Axes | License |
|---|---|---|---|
| `literata/` | Body text (serif) | `opsz` 7–72, `wght` 200–900 | `literata/OFL.txt` |
| `inter/` | Headings / UI (sans) | `opsz` 14–32, `wght` 100–900 | `inter/OFL.txt` |
| `jetbrains-mono/` | Figures / code / mono numerals | `wght` 100–800 | `jetbrains-mono/OFL.txt` |

Referenced from `templates/base.css` via `@font-face` with `font-weight: <min> <max>` ranges so the browser (and Playwright's Chromium at print time) picks the correct instance along the variable axis — no separate static weight files needed.
