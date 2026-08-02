# Implementation Plan — Ebook Studio

Ce qui existe, ce qui manque, et l'ordre de build. Aligné sur [BLUEPRINT-EBOOK-STUDIO.md](../BLUEPRINT-EBOOK-STUDIO.md). Toute nouvelle session doit lire ce fichier avant d'écrire du code, pour ne pas redéfinir ce qui est déjà décidé.

## Fait

**Session 0 — Setup**
- Repo git initialisé, poussé sur GitHub.
- `ARCHITECTURE-EBOOK-STUDIO.md` et `BLUEPRINT-EBOOK-STUDIO.md` à la racine.

**Session 1 — Structure + fondations**
- Arborescence complète créée (dossiers vides avec `.gitkeep` pour tout ce qui vient plus tard).
- Fichiers racine écrits : `README.md`, `CLAUDE.md`, `.gitignore`, `.env.example`, `.mcp.example.json`, `package.json`, `tsconfig.json`, `docs/implementation-plan.md`.

**Session 2 — Moteur : ingest + render + smoke test**
- `src/ingest/` : extraction pdfjs-dist (`legacy/build/pdf.mjs`), regroupement des items en lignes par coordonnée Y, détection colonnes (tableaux) par écart X, reconstruction paragraphes/listes/tableaux en markdown, détection CHAPTER NN/Introduction/Conclusion/BONUS (titre inline ou ligne suivante), SHA-256 du source, fallback fichier unique si aucun marqueur, `schemas/inventory.schema.json` validé via ajv avant écriture.
- `src/render/` : HTML → Paged.js (polyfill inliné, pagination pilotée par `Previewer.on("rendered")`) → Playwright `page.pdf()` (`preferCSSPageSize`, `printBackground`) + un PNG par page (`.pagedjs_page` screenshotté) dans `previews/`.
- `src/cli/` : commander, toutes les commandes `studio:*` branchées ; `ingest` et `prototype` implémentées, `audit`/`plan`/`design`/`build`/`qc` renvoient honnêtement `not_implemented` (exit 2, jamais un faux succès) ; chaque run persiste dans `state/build-state.json` (R8) avant de rendre la main.
- `tests/sample/mini-source.pdf` : fixture 3 pages (Introduction / CHAPTER 01 avec liste numérotée + petit tableau / BONUS - Test Checklist), générée par `tests/sample/generate-fixture.ts` via `src/render` (jamais des octets écrits à la main).
- Smoke test sur `workspace/projects/smoke/` : `npm run studio:ingest -- --project smoke` → exit 0, `inventory.json` correct, aucun warning.

**Session 3 — Templates + design system + plan déterministe** *(la plus critique pour la qualité — cette session)*
- `templates/` complet : `base.css` (@page 6×9in réel — voir note ci-dessous sur `size`, marges 0.75in outer / 0.9in inner, folios + running header discret via GCPM margin boxes, TOC par `target-counter`/`leader()` natifs, drop cap, orphans/widows ≥3, `break-inside: avoid`), `tokens.template.css` (tous les tokens, commentés), `chapter.html`, `frontmatter/` (title-page, copyright avec disclaimer conditionnel, toc, bonus-teaser), `backmatter/` (cta, back-cover), `components/` (les 9 partials de l'enum du plan).
- `assets/fonts/` : Literata, Inter, JetBrains Mono — polices variables OFL vendorées depuis le repo `google/fonts`, licences incluses. Inlinées en base64 au moment du render (`src/render/index.ts::inlineLocalFontUrls`) pour rester indépendantes du chemin de base du document.
- `src/design/` : `brand-input.md` (+ template jamais écrasé si déjà rempli) + thème → `design/tokens.css` ; merge `config/defaults.yaml` → thème (`themes/<n>/tokens.json`) → généré (règle disclaimer par niche) → utilisateur (brand-input parsé) → résolu, validé contre `schemas/project-config.schema.json`.
- `brand/brand-input.template.md` : niche, titre, lecteur cible, ton, disclaimer, palette hex, polices (tous optionnels sauf 10 champs requis).
- `src/plan/` : segmentation markdown déterministe → composant (numbered list ≥3 items imperatifs → process-steps, check/do → checklist, table ≤4 col → comparison-table, formule → calculation-card, Warning/Caution/Never/Important → warning-callout, blockquote → pull-quote, dernier bloc liste d'un chapitre → key-takeaways), budgets (≤1 pull-quote/chapitre, ≥1 composant non-body/4 pages), `design/page-plan.json` (+ `schemas/page-plan.schema.json`) et `reports/plan-coverage.md`.
- Démo (`workspace/projects/demo`, hors git) : palette gold/black/cream, chapitre exerçant les 7 règles de `src/plan` (toutes validées dans `plan-coverage.md`), page complète assemblée à la main avec tous les composants (h1→h3, drop cap, warning-callout, process-steps, checklist, comparison-table, calculation-card, figure SVG, pull-quote, key-takeaways) + title-page/copyright/toc/cta/back-cover, rendue en PDF 10 pages.
- **Piège découvert et corrigé** : Paged.js parse `@page { size }` avec son propre analyseur, avant la résolution CSS normale des `var()` — un `size: var(--page-width) var(--page-height)` y échoue silencieusement et retombe sur Letter (8.5×11in). `size: 6in 9in;` doit rester en dur dans `base.css` ; toutes les autres propriétés de `@page` (marges, etc.) résolvent bien leurs `var()`.
- **Limite connue, non bloquante** : le bleed plein cadre (edge-to-edge) sur `back-cover` via marges négatives + dimensions de page explicites produit des tailles de boîte incohérentes sous le moteur de fragmentation de Paged.js (`getComputedStyle` correct, `getBoundingClientRect` non). `back-cover` remplit donc la zone de contenu standard (marges normales) plutôt que de saigner jusqu'au bord physique — acceptable car la vraie couverture extérieure est générée séparément par `/cover`.

## Manque (par ordre de build)

**Session 4 — Gates QC déterministes**
- `src/qc/checks/` : les 14 checks de l'architecture, un fichier par gate.
- `src/qc/run.ts` : `qc-report.json`/`.md`, exit non-zéro sur échec, score esthétique /100 (non-bloquant).

**Session 5 — Les 7 skills** ⚠️ 3 avec matière métier à ne pas diluer (design-system, cover-design, infographics)
- `skills/pdf-ingest/SKILL.md`
- `skills/design-system/SKILL.md` — associations polices par niche
- `skills/cover-design/SKILL.md` — codes Kindle US par niche, règle titre court/long, test thumbnail
- `skills/chapter-layout/SKILL.md`
- `skills/infographics/SKILL.md` — 7 patterns SVG avec code de base
- `skills/bonus-productizer/SKILL.md` — formats livrables
- `skills/pdf-assembly/SKILL.md`

**Session 6 — Provider Higgsfield + agents + slash commands**
- `src/providers/` : `types.ts` (interface `ImageProvider`) + `higgsfield/index.ts` (impl MCP).
- `.claude/agents/` : les 6 subagents (extractor, art-director, layout-designer, infographic-designer, bonus-productizer, qa-reviewer).
- `.claude/commands/` : les 8 slash commands.

**Session 7 — Test final**
- Pas de code : premier ebook réel produit de bout en bout via le pipeline.

**Session 8 (optionnelle) — Prêt pour les associés**
- `README.md` complété ("premier ebook en 30 min" réel + troubleshooting).
- `tests/smoke-test.md` : checklist post-clone.
- `docs/onboarding.md` : clone → premier `/pipeline` en 5 étapes.

## Règle de fond

Chaque session ajoute une couche sur la précédente sans jamais improviser hors de `ARCHITECTURE-EBOOK-STUDIO.md`. Si une session dérive de l'architecture ou du blueprint, corriger le prompt plutôt que de continuer.
