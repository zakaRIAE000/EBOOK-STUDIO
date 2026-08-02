# CLAUDE.md — Ebook Studio

Mémoire projet. À lire avant toute action sur ce repo.

## Le projet en une phrase

Usine à raffiner des ebooks : un PDF brut (sortie Synthesise AI — texte bon, mise en page basique) + un brand input → un PDF premium 6×9, anglais US, toute niche. Extraction texte unique → markdown → reconstruction HTML/CSS → PDF via Paged.js + Playwright. Le niche/brand vit dans la config, jamais dans le code. Génération d'images (Higgsfield) via MCP, toujours derrière une interface provider. Gates humaines à chaque étape + gates QC déterministes avant tout GO.

Référence complète de la structure : [ARCHITECTURE-EBOOK-STUDIO.md](ARCHITECTURE-EBOOK-STUDIO.md). Ordre de build session par session : [BLUEPRINT-EBOOK-STUDIO.md](BLUEPRINT-EBOOK-STUDIO.md).

## Les 10 règles non négociables

- **R1.** On n'édite jamais `source.pdf` : extraction unique → markdown → reconstruction HTML/CSS → PDF.
- **R2.** Texte source préservé à l'identique. Corrections limitées (grammaire, caractères cassés, artefacts) et loguées dans `reports/content-changes.md`.
- **R3.** Jamais inventer : stats, témoignages, résultats, citations, garanties absents du source.
- **R4.** Diagrammes = SVG déterministe uniquement. Image-gen (Higgsfield) = covers + illustrations d'ambiance, toujours via `src/providers/`.
- **R5.** Tout texte du corps = vrai texte sélectionnable. Jamais un paragraphe rendu en image.
- **R6.** Chaque étape s'arrête et attend la validation humaine explicite. Aucun agent n'enchaîne seul.
- **R7.** Tout visuel respecte `tokens.css`. Zéro couleur/police en dur.
- **R8.** Jamais fabriquer un résultat de test. Une condition n'est remplie que si une commande le prouve et que son exit code est dans `build-state.json`. La prose n'est pas une preuve.
- **R9.** Économie de tokens : les agents chargent le chapitre en cours, jamais le PDF ni le livre entier.
- **R10.** Polices OFL uniquement (Literata / Inter / JetBrains Mono), vendorées avec licences.

## Carte des dossiers

```
.claude/commands/     8 slash commands — interface humaine du pipeline
.claude/agents/       6 subagents à contexte isolé — les exécutants
skills/                7 skills chargés à la demande — le savoir-faire (3 avec matière métier)
src/                   Le moteur TypeScript : ingest, audit, plan, design, render, qc/, providers/, cli/
schemas/               JSON Schemas — validés avant tout build
config/                Valeurs par défaut (format, marges, langue)
themes/                Directions esthétiques réutilisables entre ebooks
templates/             HTML/CSS du moteur visuel : base.css, chapter.html, frontmatter/, backmatter/, components/
brand/                 Formulaire brand-input vierge, copié dans chaque projet
assets/fonts/          Polices OFL vendorées (Literata, Inter, JetBrains Mono) + licences
workspace/projects/    Un dossier par ebook — contenu de travail (voir .gitignore pour ce qui est exclu)
tests/                 Fixture PDF + smoke test post-clone
docs/                  Implementation plan + onboarding
```

Détail fichier par fichier : voir l'arborescence complète dans [ARCHITECTURE-EBOOK-STUDIO.md](ARCHITECTURE-EBOOK-STUDIO.md).

## Ordre du pipeline (qui fait quoi)

| # | Command | Agent | Skills | Gate humaine |
|---|---------|-------|--------|--------------|
| 1 | `/ingest` | extractor | pdf-ingest | Valider découpage chapitres + bonus |
| 2 | `/design-system` | layout-designer | design-system | Valider tokens + page d'échantillon |
| 3 | `/cover` | art-director (+ MCP Higgsfield) | cover-design | Choisir parmi 3-4 concepts, itérer |
| 4 | `/chapter <n>` | layout-designer + infographic-designer | chapter-layout, infographics | Preview PDF → OK / retouches |
| 5 | `/bonus-extract` | bonus-productizer | bonus-productizer | Valider chaque livrable |
| 6 | `/assemble` | — (moteur) | pdf-assembly | Feuilleter le PDF complet |
| 7 | `/qa` | qa-reviewer | — | Gates QC + rapport → GO/NO-GO |

`/pipeline <slug>` enchaîne 1→7 en s'arrêtant à chaque gate, reprend via `state/build-state.json`.

## Conventions

- `<slug>` : kebab-case dérivé du titre de l'ebook (ex. `mastering-cold-outreach`).
- Un ebook = un dossier `workspace/projects/<slug>/`. Jamais de contenu d'un ebook spécifique hors de ce dossier (les polices/templates partagés restent à la racine).
- Le niche/brand ne vit jamais dans le code : toujours dans `brand-input.md` et `config/` du projet concerné.
- Toute commande CLI valide ses args, retourne un exit code correct, et persiste le résultat dans `state/build-state.json` (R8) avant de rendre la main.
- Langue de sortie unique : anglais US (`en-US` dans les métadonnées du PDF).
- Le vrai `.mcp.json` est créé localement via `claude mcp add higgsfield https://mcp.higgsfield.ai/mcp` — jamais commité (voir `.mcp.example.json`).
