# EBOOK STUDIO — BLUEPRINT SIMPLIFIÉ (session par session)

**Mode d'emploi** : 1 session Claude Code = 1 prompt de ce fichier. À la fin de chaque session : le prompt fait pusher sur GitHub → tu vérifies sur GitHub → `/clear` → session suivante. Ne saute jamais une validation. Le fichier `ARCHITECTURE-EBOOK-STUDIO.md` est le compagnon obligatoire : la Session 1 le colle intégralement.

**Règle d'or** : quand Claude Code dit « fini », lance toi-même `npm run studio:qc` et ouvre le PDF. Le système qui note sa propre copie passe toujours — tu es le dernier gate.

---

## SESSION 0 — Setup (terminal, hors Claude Code, ~10 min)

```bash
mkdir ebook-studio && cd ebook-studio && git init
# Copier ARCHITECTURE-EBOOK-STUDIO.md et ce blueprint à la racine
gh repo create ebook-studio --private --source=.   # ou créer via l'UI GitHub + git remote add
claude mcp add higgsfield https://mcp.higgsfield.ai/mcp   # → auth navigateur
claude    # vérifier avec /mcp que higgsfield est connecté
```

✅ **Validation** : repo sur GitHub, `/mcp` montre higgsfield connecté.

---

## SESSION 1 — Structure complète + fichiers racine

**Prompt (colle, puis colle l'architecture à l'endroit indiqué) :**

```
You are building "Ebook Studio", an ebook refinement factory running in Claude Code.
Context: an external AI (Synthesise AI) outputs ~46-page PDFs with great writing but
basic layout. This repo rebuilds them as premium products: extract text once to
markdown, rebuild as HTML/CSS paginated by Paged.js, rendered to PDF via Playwright.
Niche-agnostic (niche lives in config/brand input, never in code). US/Canada market,
English only. Higgsfield via MCP for covers, behind a provider interface. Human gates
+ deterministic QC gates.

Create the COMPLETE folder structure and ALL root files exactly as specified in the
architecture below. For CLAUDE.md, write the 10 non-negotiable rules R1-R10 from the
architecture, the folder map, and the pipeline flow table. Create only the folders
(with .gitkeep) for everything else — src/, skills/, templates/, .claude/ contents
come in later sessions. Root files to fully write NOW: README.md (onboarding
placeholder), CLAUDE.md, .gitignore, .env.example, .mcp.example.json, package.json,
tsconfig.json, docs/implementation-plan.md.

[COLLER ICI TOUT LE CONTENU DE ARCHITECTURE-EBOOK-STUDIO.md]

When done: git add -A && git commit -m "session 1: structure + foundations" && git push.
```

✅ **Validation** : `CLAUDE.md` contient bien R1→R10 ; l'arborescence correspond à l'architecture ; `.gitignore` exclut sources/outputs/`.env`/`.mcp.json` ; push visible. → `/clear`

---

## SESSION 2 — Moteur : ingest + render + smoke test

**Prompt :**

```
Read CLAUDE.md and docs/implementation-plan.md first. Implement per the architecture:

1. src/ingest/ (npm run studio:ingest -- --project <slug>): pdfjs-dist extraction,
   SHA-256 of source, detect "CHAPTER XX"/"Introduction"/"Conclusion"/"BONUS"
   (Synthesise AI patterns), one markdown per chapter in content/chapters/,
   BONUS sections → bonuses/raw/ (never in chapters), ignore source images,
   output inventory.json validated against schemas/inventory.schema.json (create it).
   Fallback if no pattern: single file + warning. Never crash silently.

2. src/render/ (npm run studio:prototype): HTML → inject Paged.js → paginate →
   Playwright PDF (preferCSSPageSize, printBackground), wait for fonts.ready AND
   Paged.js "rendered" event. Also export every page as PNG to previews/.

3. src/cli/: commander entries wired to package.json scripts. Every command:
   validates args, correct exit codes, persists results to state/build-state.json (R8).

4. tests/sample/mini-source.pdf: generate a 3-page fixture (Introduction /
   CHAPTER 01 with a numbered list + small table / BONUS - Test Checklist) using
   your own render module.

5. Smoke test: workspace/projects/smoke/ from the fixture → studio:ingest →
   show me inventory.json.

When done: git add -A && git commit -m "session 2: engine + smoke test" && git push.
```

✅ **Validation** : `inventory.json` du smoke = 1 intro + 1 chapitre + 1 bonus ; les `.md` contiennent le texte ; un PDF s'est rendu via Paged.js. → `/clear`

---

## SESSION 3 — Templates + design system + plan déterministe

**La session la plus importante pour la qualité.**

**Prompt :**

```
Read CLAUDE.md first. Implement per the architecture:

1. templates/ — everything listed (base.css, tokens.template.css, chapter.html,
   frontmatter/, backmatter/, components/ — one partial per component). Goal:
   "real premium US book". base.css specs: @page 6x9in, margins 0.75in outer /
   0.9in inner, footer folios, discreet running header, body 11pt / line-height
   1.55, orphans/widows ≥3, page-break-before on chapter h1, break-inside:avoid
   on figures/callouts/tables, drop cap on first chapter paragraph, hyphens:auto.
   ALL colors/fonts via CSS variables (R7). TOC page numbers via Paged.js
   target-counter (native — no double-render hack).

2. assets/fonts/: vendor Literata, Inter, JetBrains Mono (OFL) with licenses.

3. src/design/ (npm run studio:design): brand-input.md + theme → project
   tokens.css. Config merge defaults → preset → generated → user → resolved,
   validated against schemas/project-config.schema.json (create it).
   Never overwrite the user file. Also create brand/brand-input.template.md
   per the architecture.

4. src/plan/ (npm run studio:plan): segment chapters into blocks, assign
   components. DETERMINISTIC RULES FIRST: numbered list ≥3 imperative items →
   process-steps; check/do list → checklist; table ≤4 cols → comparison-table;
   formula → calculation-card; paragraph starting Warning/Caution/Never/Important
   → warning-callout; chapter-final summary → key-takeaways; blockquote →
   pull-quote; rest → editorial-body. Ambiguous leftovers only: max 1 in-session
   decision per chapter against the closed enum. Budgets: max 1 hero/chapter,
   ≥1 non-body component per 4 pages. Output page-plan.json (+ schema) and
   reports/plan-coverage.md; if editorial-body >70%, say so explicitly.

5. DEMO: demo tokens.css (gold/black/cream) + one page showing ALL components
   (h1→h3, drop cap, callouts, table, pull quote, figure, process-steps,
   checklist, key-takeaways) → render → give me the PDF path.

When done: git add -A && git commit -m "session 3: templates + design + plan" && git push.
```

✅ **Validation — passe du temps ici** : ouvre le PDF de démo et juge en client. Hiérarchie nette ? Marges de vrai livre ? Composants élégants ? **Itère jusqu'à ce que tu paierais pour ce rendu** — chaque retouche de `base.css` profite à tous tes futurs ebooks. → `/clear`

---

## SESSION 4 — Gates QC déterministes

**Prompt :**

```
Read CLAUDE.md first. Implement src/qc/ (npm run studio:qc -- --project <slug>):
one file per check in src/qc/checks/ per the architecture list (fonts-embedded,
text-coverage ≥95%, no-broken-chars, ink-coverage 2-62%, no-overflow >2px measured
in Playwright post-pagination, min-font-size 9.5pt, contrast ≥4.5:1, assets-exist,
image-dpi ≥150, outline-toc, metadata en-US, file-size <15MB, no-bonus-in-body,
structure). Each returns {id, pass, evidence}. Runner writes reports/qc-report.json
and .md, exits non-zero on ANY failure, records exit code in build-state.json.
Plus the aesthetic score /100 (gates nothing — a note to the human with weak page
numbers; rubric: content 25, typography 20, layout 20, consistency 15, technical 10,
niche fit 10).
Run full QC on the smoke project + session-3 demo. Show me qc-report.md.
When done: git add -A && git commit -m "session 4: QC gates" && git push.
```

✅ **Validation** : lance toi-même `npm run studio:qc -- --project smoke` → exit 0. **Puis casse un truc exprès** (retire une police du CSS) et vérifie que le gate passe au rouge. Un gate jamais vu échouer ne protège rien. → `/clear`

---

## SESSION 5 — Les 7 skills ⚠️ AVEC MATIÈRE À FOURNIR

C'est ici que ta vigilance compte : **3 skills ont besoin de matière métier** (marquée MATERIAL). Elle est déjà écrite dans le prompt ci-dessous — vérifie après coup qu'elle est intégralement dans les SKILL.md, pas résumée.

**Prompt :**

```
Read CLAUDE.md first. Create the 7 skills as skills/<name>/SKILL.md, each with YAML
frontmatter (name, triggering description). For the 3 skills marked MATERIAL,
incorporate ALL the material verbatim in spirit — it is hard-won market knowledge,
do not water it down or genericize it.

1. pdf-ingest: text-layer extraction only; chapter naming 00-introduction.md →
   NN-<slug>.md; source images always ignored; BONUS leaves the body at ingest;
   inventory.json = single source of truth (R9); sanity checks for a valid inventory.

2. design-system — MATERIAL (font pairing by niche, OFL fonts only):
   finance/trading/business = Literata body + Inter headings, tight tracking,
   authority; self-help = Source Serif 4 or Literata + generous line-height,
   warmth; health/wellness = light, airy, high whitespace; tech/how-to = modern
   sans headings + JetBrains Mono for code. WCAG computed (body ≥4.5:1, large
   headings ≥3:1). Modular scale base 11pt, ratio 1.25-1.333. Always produce a
   one-page sample PDF for human validation.

3. cover-design — THE critical skill. MATERIAL (US Kindle codes by niche):
   finance/trading = dark background, gold/green accents, bold condensed type,
   abstracted data motif (chart lines, candlesticks); self-help = light background,
   oversized type, ONE visual metaphor (door, path, sunrise); business = minimalism,
   strong contrast, negative space, one bold graphic idea; health = clean, natural
   palette (greens, creams), calm.
   PRODUCTION RULE: short title (≤4 words, no subtitle) → text integrated in-image
   via Higgsfield's text-capable model (Nano Banana Pro); long title OR subtitle →
   background art WITHOUT text + typography composed as HTML/SVG overlay rendered
   by our render module.
   WORKFLOW: 3-4 differentiated written concepts (concept, palette, composition,
   model, exact prompt) → human choice → generate → iterate.
   SPECS: 1600x2560px Kindle + 6x9in 300dpi for the PDF + back cover + bonus
   mini-covers. THUMBNAIL TEST: title readable at 100px wide or the concept fails.

4. chapter-layout: premium chapter anatomy (opener with oversized number, thin
   rule, whitespace → drop cap → rhythm); insertion rules (criteria list →
   checklist; warning → warning callout; key idea → key-idea box; max 1 pull
   quote/chapter); density 1 visual per 2-3 pages; consumes page-plan.json, never
   re-decides by eye; never modifies text (R2).

5. infographics — MATERIAL: doctrine = diagrams are deterministic SVG, NEVER
   image-gen (R4). Include WORKING base SVG code for each of the 7 patterns,
   parameterized only by tokens.css variables, viewBox set for crisp print:
   horizontal process flow (3-6 steps), traffic light (3 states), side-by-side
   comparison, timeline (4-6 milestones), before/after split, pyramid (3-5
   levels), decision table (criteria × options). Each: when to use + data shape
   + base code.

6. bonus-productizer — MATERIAL: checklist → one-page branded PDF with checkboxes;
   worksheet → fillable PDF (real form fields); Notion template → structured
   markdown ready to import + instructions. Each bonus gets a mini-cover (derived
   from the book cover) and a displayed value ("$27 value"). The ebook gets
   lighter, the offer gets richer.

7. pdf-assembly: canonical order cover → title → copyright+disclaimer → bonus
   teaser → TOC → chapters → CTA → back cover; roman numerals for front matter,
   arabic for body; TOC via target-counter; PDF metadata; pre-export checklist.

When done: git add -A && git commit -m "session 5: skills" && git push.
```

✅ **Validation** : lis en entier `cover-design/SKILL.md` (règle titre court/long + test thumbnail présents ?) et `infographics/SKILL.md` (les 7 patterns ont du **vrai code SVG** paramétré tokens, pas des descriptions ?). Si résumé ou dilué → renvoie la matière manquante à Claude Code. → `/clear`

---

## SESSION 6 — Provider Higgsfield + agents + slash commands

**Prompt :**

```
Read CLAUDE.md first. Three deliverables:

A) src/providers/ per the architecture: types.ts (ImageProvider interface — the
   ONLY door to image generation, R4) and higgsfield/index.ts (active impl via
   the connected MCP server: saves images to cover/concepts/ or visuals/ambient/,
   writes cover/generation-log.json with model + exact prompt, converts to output
   specs 1600x2560 + 6x9 300dpi). Cost discipline documented: written concepts
   validated by the human BEFORE any generation call.

B) The 6 subagents in .claude/agents/ exactly per the architecture (extractor,
   art-director, layout-designer, infographic-designer, bonus-productizer,
   qa-reviewer), each with YAML frontmatter (name, description, allowed tools)
   and the constraints listed there. EVERY agent ends with a summary + the human
   validation question. No agent chains to the next step on its own (R6).

C) The 8 slash commands in .claude/commands/ exactly per the architecture
   (/ingest, /design-system, /cover, /chapter, /bonus-extract, /assemble, /qa,
   /pipeline), each with $ARGUMENTS, precise steps, agent(s) invoked, explicit
   validation gate. /pipeline resumes from state/build-state.json and shows
   progress (step X/7).

When done: git add -A && git commit -m "session 6: provider + agents + commands" && git push.
```

✅ **Validation** : tape `/` dans Claude Code → les 8 commands apparaissent. Ouvre 2 agents : la contrainte stop/validation y est. → `/clear`

---

## SESSION 7 — TEST FINAL : ton premier ebook réel

Pas de prompt de construction — c'est le pipeline lui-même qui tourne.

### 📥 OÙ DÉPOSER TES INPUTS (à lire avant de lancer)

**Rien ne s'uploade dans une conversation.** Tout se dépose sur ta machine, dans un dossier par ebook, sous `workspace/projects/<slug>/`. Ce dossier n'est jamais poussé sur GitHub (le `.gitignore` l'exclut).

**Input 1 — le PDF Synthesise AI** (obligatoire, tu le déposes toi-même) :
```bash
mkdir -p workspace/projects/<slug>/source
# avec ton explorateur de fichiers (ou cp), déposer le PDF ici
# et le renommer EXACTEMENT : original.pdf
```
Chemin final attendu : `workspace/projects/<slug>/source/original.pdf`. C'est ce que `/ingest` lit. Le nom `original.pdf` compte.

**Input 2 — la brand foundation** (deux options) :
- *Option simple :* tu ne fais rien maintenant. À l'étape `/design-system`, la commande copie le formulaire vierge dans `workspace/projects/<slug>/brand-input.md` et te demande de le remplir dans VS Code (niche, titre, palette en hex, polices, ton, disclaimer). Tu remplis, tu relances.
- *Option pré-remplie :* si ta brand est déjà prête, crée `workspace/projects/<slug>/brand-input.md` à la main avant de lancer. La commande verra qu'il est rempli et passera directement à la génération du `tokens.css`.

**Input 3 — logo / assets spécifiques** (optionnel) :
Si cet ebook a un logo ou des polices propres, dépose-les dans `workspace/projects/<slug>/assets/`. Pour la v1, la palette hex dans `brand-input.md` suffit généralement — le logo devient utile surtout pour la back cover et les mini-covers de bonus.

> ⚠️ Ne dépose jamais tes inputs à la racine du repo ni dans `brand/`. Toujours dans `workspace/projects/<slug>/`. Un dossier par ebook, tout au même endroit, tout hors GitHub.

### Le déroulé

Puis dans Claude Code, une commande à la fois :

| Étape | Commande | Ce que TU valides |
|---|---|---|
| 1 | `/ingest <slug>` | Découpage : bons chapitres, bonus détectés |
| 2 | `/design-system <slug>` | Remplis `brand-input.md` → page d'échantillon |
| 3 | `/cover <slug>` | Concepts écrits → choix → génération → **test thumbnail** |
| 4 | `/chapter <slug> 1` | **En détail** — le chap. 1 calibre tout le style |
| 5 | `/chapter <slug> 2…n` | Rapide, le style est établi |
| 6 | `/bonus-extract <slug>` | Chaque livrable, un par un |
| 7 | `/assemble <slug>` | Feuillette le PDF complet |
| 8 | `/qa <slug>` | Gates + rapport → GO |

**Critères de réussite finaux :**
- PDF complet dans l'ordre canonique, TOC cliquable juste, **zéro** BONUS dans le corps
- Livrables bonus brandés avec mini-covers
- `npm run studio:qc` → exit 0 **quand c'est toi qui le lances**
- **Le vrai critère : ce PDF donne envie de payer plus cher que la version Synthesise AI brute**

Quand c'est GO : `git add -A && git commit -m "session 7: first real ebook GO" && git push`

**Boucle d'amélioration** : tout défaut récurrent → fix dans `base.css` / le skill / un gate QC, **jamais dans un chapitre**. Après chaque fix système : re-render l'ebook n°1 + re-QC (non-régression). C'est ce qui rend l'ebook n°2 meilleur et plus rapide que le n°1.

---

## SESSION 8 (optionnelle) — Prêt pour les associés

**Prompt :**

```
Read CLAUDE.md first. Team-readiness:
1. Verify .gitignore excludes .env, .mcp.json, workspace sources/outputs/previews/state.
2. Complete README.md "First ebook in 30 minutes" (real session from session 7) +
   troubleshooting table (playwright install chromium; "done but no PDF" → run
   studio:qc, the exit code is the truth; "building infrastructure instead of a
   PDF" → Esc + "render the prototype first").
3. tests/smoke-test.md: post-clone checklist (npm install, playwright, claude mcp
   add higgsfield, ingest+prototype on tests/sample/, studio:qc exit 0).
4. docs/onboarding.md: clone → first /pipeline in 5 steps.
When done: git add -A && git commit -m "session 8: team-ready" && git push.
```

✅ **Validation finale** : clone frais sur un autre dossier/machine → déroule `smoke-test.md` → tout passe. **L'usine est ouverte.**

---

## Anti-dérive (garde sous les yeux)

1. Une session = un prompt de ce fichier. `/clear` entre chaque.
2. Push vérifié sur GitHub à chaque fin de session.
3. Session 3 = là où vit la qualité de toute ta collection. Ne la bâcle pas.
4. Higgsfield : concepts écrits **avant** génération, toujours (crédits).
5. `Esc` si Claude Code construit de l'architecture au lieu de livrer.
6. Si une session dérive : `git checkout .` et reformule — plus rapide que corriger.
