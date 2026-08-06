# Onboarding — du clone au premier `/pipeline`

Cinq étapes. Compter ~10 min d'installation, puis le pipeline lui-même (voir
[README](../README.md#premier-ebook-en-30-minutes) pour les durées réelles mesurées).

Avant d'écrire la moindre ligne de code : lire [CLAUDE.md](../CLAUDE.md) — les règles
R1-R10 ne sont pas des conseils, elles sont les invariants du projet.

---

## 1. Installer

```bash
git clone <repo> && cd ebook-studio
npm install
npx playwright install chromium
```

`npm install` **ne télécharge pas** le navigateur. Sans la deuxième commande, tout
rendu échoue avec `Executable doesn't exist`.

Vérifier que la chaîne complète fonctionne avant d'y mettre un vrai livre :
[tests/smoke-test.md](../tests/smoke-test.md) — doit finir sur `studio:qc` en exit 0.

## 2. Brancher la génération d'images (optionnel)

```bash
claude mcp add higgsfield https://mcp.higgsfield.ai/mcp   # auth navigateur
```

Nécessaire seulement pour `/cover` et les illustrations d'ambiance. Le `.mcp.json`
produit n'est **jamais** commité (voir `.mcp.example.json`). `.env` n'est utile que
pour appeler l'API Higgsfield hors MCP — copier `.env.example` si besoin.

Sans Higgsfield, tout le reste du pipeline fonctionne : `/cover` est la seule étape
qui s'arrête.

## 3. Créer le projet

Un ebook = un dossier sous `workspace/projects/<slug>/`, en kebab-case dérivé du titre
(ex. `mastering-cold-outreach`). Rien de spécifique à un livre ne vit ailleurs.

```bash
mkdir -p workspace/projects/<slug>/source
cp /chemin/vers/export-synthesise.pdf workspace/projects/<slug>/source/original.pdf
cp brand/brand-input.template.md workspace/projects/<slug>/brand-input.md
```

## 4. Remplir `brand-input.md`

C'est le seul endroit où vivent la niche et la marque — jamais dans le code.
Les champs marqués *(required)* bloquent `studio:design` tant qu'ils sont vides ; le
reste retombe sur les défauts de `config/defaults.yaml` ou du thème.

Deux champs à ne pas bâcler :

- **Niche** — pilote l'obligation de disclaimer. `finance` / `trading` / `health`
  rendent le disclaimer **obligatoire**, et l'assemblage échoue si son texte est vide.
- **CTA / back cover** — laissés vides, ces sections sont simplement omises du livre.
  C'est voulu : les inventer serait fabriquer une promesse commerciale que le projet
  n'a pas faite (R3).

## 5. Lancer le pipeline

Dans Claude Code :

```
/pipeline <slug>
```

Le pipeline enchaîne les 7 étapes et **s'arrête à chaque gate humaine** (R6). Aucun
agent ne poursuit seul. L'état est persisté dans `workspace/projects/<slug>/state/build-state.json`,
donc une session interrompue reprend là où elle s'est arrêtée.

Pour reprendre en connaissance de cause :

```bash
npm run studio:status -- --project <slug>
```

Les étapes peuvent aussi se lancer une par une (`/ingest`, `/design-system`, `/cover`,
`/chapter <n>`, `/bonus-extract`, `/assemble`, `/qa`) — utile quand une seule étape est
à refaire.

---

## Ce qu'il faut avoir compris avant de valider une gate

- **L'exit code est la preuve, pas la prose** (R8). « C'est fait » ne vaut rien tant que
  `npm run studio:qc -- --project <slug>` n'est pas sorti en 0 et que le résultat n'est
  pas dans `build-state.json`.
- **Le texte source ne se réécrit pas** (R2). Les corrections admises (grammaire,
  caractères cassés, artefacts d'extraction) se loguent dans `reports/content-changes.md`.
- **Rien ne s'invente** (R3) : ni chiffre, ni témoignage, ni garantie absente du source.
- **Une gate `skipped` n'est pas une gate réussie.** Elle signale une entrée manquante,
  pas une vérification passée.
