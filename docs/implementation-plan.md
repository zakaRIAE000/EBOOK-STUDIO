# Implementation Plan — Ebook Studio

Ce qui existe, ce qui manque, et l'ordre de build. Aligné sur [BLUEPRINT-EBOOK-STUDIO.md](../BLUEPRINT-EBOOK-STUDIO.md). Toute nouvelle session doit lire ce fichier avant d'écrire du code, pour ne pas redéfinir ce qui est déjà décidé.

## Fait

**Session 0 — Setup**
- Repo git initialisé, poussé sur GitHub.
- `ARCHITECTURE-EBOOK-STUDIO.md` et `BLUEPRINT-EBOOK-STUDIO.md` à la racine.

**Session 1 — Structure + fondations** *(cette session)*
- Arborescence complète créée (dossiers vides avec `.gitkeep` pour tout ce qui vient plus tard).
- Fichiers racine écrits : `README.md`, `CLAUDE.md`, `.gitignore`, `.env.example`, `.mcp.example.json`, `package.json`, `tsconfig.json`, `docs/implementation-plan.md`.

## Manque (par ordre de build)

**Session 2 — Moteur : ingest + render + smoke test**
- `src/ingest/` : extraction pdfjs-dist, détection CHAPTER/Introduction/Conclusion/BONUS, `inventory.json` + `schemas/inventory.schema.json`.
- `src/render/` : HTML → Paged.js → Playwright PDF + PNG previews.
- `src/cli/` : commander, branché sur les scripts `studio:*` de `package.json`, exit codes + `state/build-state.json` (R8).
- `tests/sample/mini-source.pdf` : fixture 3 pages.
- Smoke test sur `workspace/projects/smoke/`.

**Session 3 — Templates + design system + plan déterministe** *(la plus critique pour la qualité)*
- `templates/` complet (base.css @page 6×9, frontmatter/, backmatter/, components/).
- `assets/fonts/` : Literata, Inter, JetBrains Mono (OFL) + licences.
- `src/design/` : brand-input + thème → `tokens.css`, merge de config, `schemas/project-config.schema.json`.
- `brand/brand-input.template.md`.
- `src/plan/` : règles déterministes → `page-plan.json` + `reports/plan-coverage.md`.
- Démo : page avec tous les composants, rendue en PDF.

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
