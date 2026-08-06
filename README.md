# Ebook Studio

Usine à raffiner des ebooks : PDF brut (Synthesise AI, texte bon / mise en page basique) + brand foundation → PDF premium 6×9, anglais US, toute niche. Tourne dans Claude Code (VS Code).

## Statut

✅ **Pipeline complet et éprouvé sur un vrai livre.** Les 7 étapes, les 8 slash commands, les 6 agents, le moteur TypeScript et les 17 gates QC sont en place. Premier ebook réel produit de bout en bout : 89 pages, 9 chapitres, 2 bonus, `studio:qc` en **GO 17/17**.

Nouveau sur le repo ? → [docs/onboarding.md](docs/onboarding.md) (clone → premier `/pipeline` en 5 étapes), puis [tests/smoke-test.md](tests/smoke-test.md) pour vérifier l'installation.

## Premier ebook en 30 minutes

Parcours réel, mesuré sur le premier livre produit par le pipeline.

```bash
git clone <repo> && cd ebook-studio
npm install
npx playwright install chromium          # npm install ne télécharge PAS le navigateur

mkdir -p workspace/projects/<slug>/source
cp mon-export-synthesise.pdf workspace/projects/<slug>/source/original.pdf
cp brand/brand-input.template.md workspace/projects/<slug>/brand-input.md
# remplir brand-input.md (niche + marque), puis dans Claude Code :
```

```
/pipeline <slug>
```

Le pipeline s'arrête à **chaque** gate humaine (R6). Ce que la machine coûte réellement, mesuré sur ce livre (`state/build-state.json`, somme des 18 étapes) :

| Étape | Temps machine |
|---|---|
| `ingest` (50 p. source → 9 chapitres + 2 bonus) | 1,8 s |
| `design` (brand-input → tokens.css) | 0,1 s |
| `plan` + `audit` | < 0,1 s |
| `cover` (rendu print 1800×2700) | 4,9 s |
| `prototype` × 9 chapitres | 2,6–5,0 s chacun |
| `bonus` × 2 (checklist + worksheet) | 2,8 s / 3,8 s |
| `build` (assemblage 89 pages) | 51,5 s |
| `qc` (17 gates) | 50,6 s |
| **Total machine** | **≈ 2,5 min** |

Les 30 minutes ne sont donc pas du calcul : ce sont **les gates humaines**. Le temps part dans le choix de couverture, la relecture des chapitres et le feuilletage final — exactement là où il doit partir. Un livre plus long ne déplace que `build` et `qc`.

Reprendre une session interrompue : l'état est dans `state/build-state.json`, `/pipeline <slug>` repart de la dernière étape validée (`npm run studio:status -- --project <slug>` pour la lire).

## Slash commands

| Command | Rôle | Gate humaine |
|---|---|---|
| `/pipeline <slug>` | Enchaîne tout le pipeline (1→7), reprend via `state/build-state.json` | Une à chaque étape |
| `/ingest <slug>` | PDF → chapitres markdown + `inventory.json` | Valider découpage chapitres + bonus |
| `/design-system <slug>` | Brand input → `tokens.css` + page d'échantillon | Valider tokens + page d'échantillon |
| `/cover <slug>` | Concepts de couverture écrits → génération Higgsfield → final | Choisir parmi 3-4 concepts, itérer |
| `/chapter <slug> <n>` | Maquette + visuels d'un chapitre → preview PDF | OK ou retouches |
| `/bonus-extract <slug>` | Bonus bruts → livrables brandés | Valider chaque livrable |
| `/assemble <slug>` | Assemble le PDF final complet | Feuilleter le PDF complet |
| `/qa <slug>` | Gates QC déterministes + inspection visuelle | GO / NO-GO |

*(Implémentées dans `.claude/commands/` à partir de la Session 6 — voir [ARCHITECTURE-EBOOK-STUDIO.md](ARCHITECTURE-EBOOK-STUDIO.md).)*

## Documentation

- [docs/onboarding.md](docs/onboarding.md) — **commencer ici** : clone → premier `/pipeline` en 5 étapes
- [tests/smoke-test.md](tests/smoke-test.md) — vérification après clone (doit finir en exit 0)
- [CLAUDE.md](CLAUDE.md) — règles non négociables (R1-R10) + mémoire projet
- [ARCHITECTURE-EBOOK-STUDIO.md](ARCHITECTURE-EBOOK-STUDIO.md) — source de vérité de la structure du repo
- [BLUEPRINT-EBOOK-STUDIO.md](BLUEPRINT-EBOOK-STUDIO.md) — plan de build session par session
- [docs/implementation-plan.md](docs/implementation-plan.md) — ce qui existe / manque / ordre de build

## Troubleshooting

Cas réellement rencontrés en produisant le premier ebook.

| Symptôme | Cause | Quoi faire |
|---|---|---|
| `Executable doesn't exist at ...chrome.exe` — tout rendu échoue | `npm install` ne télécharge pas le navigateur Playwright | `npx playwright install chromium` |
| L'agent annonce « c'est fait », mais aucun PDF n'existe / il est vieux | La prose de complétion n'est pas une preuve (R8) | `npm run studio:qc -- --project <slug>` — **l'exit code est la vérité**, pas le message. Vérifier aussi que la date du PDF est postérieure à la dernière modif |
| L'agent construit de l'infrastructure au lieu d'un PDF (refactors, helpers, abstractions) | La tâche a dérivé du livrable | `Esc`, puis : « render the prototype first » — repartir d'un rendu visible avant toute généralisation |
| `studio:qc` sort en 1 sur `metadata`, titre « Ebook Studio prototype » | `studio:prototype` inscrit son titre par défaut | Passer `--title "<titre exact de config/resolved.yaml>"` |
| Une gate est `skipped` et on la lit comme réussie | `skipped` = entrée absente, pas vérification passée (R8) | Vérifier si l'entrée devait exister (une couverture manquante fait skipper `cover-renders`) |
| Polices absentes / substituées dans le PDF | Police non vendorée ou référencée en dur | Vérifier `assets/fonts/` et le passage par `tokens.css`, jamais de police en dur (R7) |
| `disclaimer.required = true` mais texte vide → l'assemblage s'arrête | Niche finance/trading/health sans disclaimer rempli | Compléter le disclaimer dans `brand-input.md`, relancer `studio:design` |
| Du texte disparaît entre deux pages | Césure automatique : Paged.js et le rendu ne coupent pas au même endroit | Déjà corrigé (`hyphens: manual` dans `templates/base.css`). La gate `no-hyphen-page-break` échoue si la régression revient |
