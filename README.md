# Ebook Studio

Usine à raffiner des ebooks : PDF brut (Synthesise AI, texte bon / mise en page basique) + brand foundation → PDF premium 6×9, anglais US, toute niche. Tourne dans Claude Code (VS Code).

## Statut

🚧 **Session 1 — structure + fondations.** Le moteur, les templates, les skills, les agents et les slash commands arrivent dans les sessions suivantes. Voir [docs/implementation-plan.md](docs/implementation-plan.md) pour le détail de ce qui existe / manque.

## Premier ebook en 30 minutes (une fois le pipeline en place)

1. `git clone <repo>` puis `npm install`
2. `claude mcp add higgsfield https://mcp.higgsfield.ai/mcp` (auth navigateur) — voir `.mcp.example.json`
3. `cp .env.example .env` et renseigner `HIGGSFIELD_API_KEY` uniquement si tu appelles l'API Higgsfield hors MCP
4. Déposer le PDF source dans `workspace/projects/<slug>/source/original.pdf`
5. Dans Claude Code : `/pipeline <slug>` — le pipeline s'arrête à chaque gate humaine

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

- [BLUEPRINT-EBOOK-STUDIO.md](BLUEPRINT-EBOOK-STUDIO.md) — plan de build session par session
- [ARCHITECTURE-EBOOK-STUDIO.md](ARCHITECTURE-EBOOK-STUDIO.md) — source de vérité de la structure du repo
- [CLAUDE.md](CLAUDE.md) — règles non négociables (R1-R10) + mémoire projet
- [docs/implementation-plan.md](docs/implementation-plan.md) — ce qui existe / manque / ordre de build

## Troubleshooting

À compléter en Session 8 avec les cas rencontrés en Session 7 (premier ebook réel). Points connus à surveiller dès maintenant :

- **Playwright sans navigateur** : après `npm install`, lancer `npx playwright install chromium` avant tout render.
- **"Fini" sans preuve** : ne jamais faire confiance à une prose de complétion — lancer `npm run studio:qc` et vérifier l'exit code (R8).
- **Fonts manquantes au rendu** : vérifier que les polices sont bien dans `assets/fonts/` et référencées via `tokens.css`, jamais en dur (R7).
