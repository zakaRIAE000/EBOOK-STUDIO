# Smoke test — après clone

Vérifie qu'un clone frais peut produire un PDF et le faire passer par les gates QC,
**sans toucher à un vrai ebook**. À lancer une fois après chaque clone, et après toute
mise à jour de dépendances.

Tout ce dont le test a besoin est versionné dans `tests/sample/` — le projet `smoke`
lui-même vit sous `workspace/projects/`, qui n'est jamais commité (voir `.gitignore`).

## 0. Prérequis

```bash
npm install
npx playwright install chromium        # obligatoire : npm install ne télécharge pas le navigateur
```

Optionnel, seulement si tu comptes générer des visuels (`/cover`, illustrations) :

```bash
claude mcp add higgsfield https://mcp.higgsfield.ai/mcp
```

Le smoke test n'appelle aucun provider d'image — il passe sans Higgsfield.

## 1. Monter le projet de test depuis les fixtures

```bash
mkdir -p workspace/projects/smoke/source workspace/projects/smoke/html
cp tests/sample/mini-source.pdf  workspace/projects/smoke/source/original.pdf
cp tests/sample/brand-input.md   workspace/projects/smoke/brand-input.md
cp tests/sample/smoke-book.html  workspace/projects/smoke/html/smoke-book.html
```

`mini-source.pdf` est une fixture de 3 pages qui imite une sortie Synthesise AI
(Introduction / CHAPTER 01 avec liste numérotée et petit tableau / BONUS). Elle est
régénérable par le moteur lui-même, jamais écrite à la main :
`npx tsx tests/sample/generate-fixture.ts`.

## 2. Dérouler le pipeline

```bash
npm run studio:ingest    -- --project smoke
npm run studio:design    -- --project smoke
npm run studio:prototype -- --project smoke --html html/smoke-book.html \
                            --out output/prototype.pdf --previews \
                            --title "Smoke Test Book"
npm run studio:qc        -- --project smoke
```

⚠️ **`--title "Smoke Test Book"` n'est pas décoratif.** Sans lui, `studio:prototype`
inscrit son titre par défaut (« Ebook Studio prototype ») dans les métadonnées du PDF,
et la gate `metadata` échoue — `studio:qc` sort alors en **1**, pas 0. Le titre doit
correspondre à `project.title` de `config/resolved.yaml`.

## 3. Résultat attendu

```
QC GO: 13/17 gate(s) passed, aesthetic score 97/100
  (skipped: assets-exist, cover-renders, image-dpi, folio-continuity)
```

**Exit code 0.** C'est le seul critère de réussite (R8) — la prose de sortie ne prouve
rien, l'exit code si :

```bash
npm run studio:qc -- --project smoke; echo "exit=$?"
```

Les 4 gates *skipped* sont normales pour cette fixture, et ne doivent pas être lues
comme des échecs :

| Gate skipped | Pourquoi c'est attendu ici |
|---|---|
| `assets-exist` | le fragment ne référence aucun asset local |
| `cover-renders` | pas de `<section class="cover-page">` — un prototype n'a pas de couverture |
| `image-dpi` | aucune image raster (les diagrammes SVG sont exemptés, R4) |
| `folio-continuity` | un prototype n'imprime pas de folio |

Une gate `skipped` n'est jamais comptée comme réussie (R8) ; elle n'est simplement pas
bloquante quand son entrée n'existe pas.

## 4. En cas d'échec

| Symptôme | Cause probable |
|---|---|
| `Executable doesn't exist at ...chrome.exe` | `npx playwright install chromium` non lancé |
| `metadata` FAIL, titre « Ebook Studio prototype » | `--title` oublié à l'étape 2 |
| `No inventory.json` / `No config/resolved.yaml` | une étape précédente a été sautée — relancer dans l'ordre |
| `No output/ directory` | `studio:prototype` n'a pas écrit son PDF ; relire son exit code |

## 5. Nettoyage

```bash
rm -rf workspace/projects/smoke
```

Rien à nettoyer côté dépôt : `workspace/projects/` est ignoré par git.
