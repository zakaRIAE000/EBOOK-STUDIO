# EBOOK STUDIO — ARCHITECTURE COMPLÈTE DU REPO

Usine à raffiner des ebooks. Input : PDF Synthesise AI + brand foundation. Output : PDF premium 6×9, anglais US, toute niche. Tourne dans Claude Code (VS Code). Ce fichier est la **source de vérité** : c'est lui qu'on colle dans la Session 1 du blueprint pour que Claude Code génère la structure exacte.

```
ebook-studio/
├── README.md                        # Onboarding associés : clone → premier ebook en 30 min,
│                                    # tableau des slash commands, troubleshooting
├── CLAUDE.md                        # Mémoire projet : les 10 règles non négociables (R1-R10),
│                                    # carte des dossiers, ordre du pipeline, conventions
├── .gitignore                       # node_modules/, .env, .mcp.json, dist/,
│                                    # workspace/projects/*/source|output|previews|state
├── .env.example                     # HIGGSFIELD_API_KEY= (placeholder, si usage API hors MCP)
├── .mcp.example.json                # Entrée serveur MCP Higgsfield (URL officielle, sans secrets)
│                                    # → le vrai .mcp.json est créé par `claude mcp add`, jamais commité
├── package.json                     # deps : playwright, pagedjs, pdfjs-dist, commander, ajv, yaml
│                                    # scripts : studio:ingest/audit/plan/design/prototype/build/qc/all/status
├── tsconfig.json                    # strict, NodeNext, ES2022
│
├── .claude/
│   ├── commands/                    # LE PIPELINE — interface humaine (8 slash commands)
│   │   ├── pipeline.md              # /pipeline <slug> : mode guidé A→Z, s'arrête à chaque gate,
│   │   │                            # barre de progression, reprend via state/build-state.json
│   │   ├── ingest.md                # /ingest <slug> : PDF → chapitres md + inventaire → validation découpage
│   │   ├── design-system.md         # /design-system <slug> : brand-input → tokens.css + page échantillon
│   │   ├── cover.md                 # /cover <slug> : 3-4 concepts écrits → choix → Higgsfield → final
│   │   ├── chapter.md               # /chapter <slug> <n> : layout + SVG → preview PDF → "OK ou retouches ?"
│   │   ├── bonus-extract.md         # /bonus-extract <slug> : bonus → livrables brandés, validés un par un
│   │   ├── assemble.md              # /assemble <slug> : vérifie chapitres validés → PDF final complet
│   │   └── qa.md                    # /qa <slug> : gates QC + inspection visuelle → GO/NO-GO
│   │
│   └── agents/                      # LES EXÉCUTANTS — subagents à contexte isolé (6)
│       ├── extractor.md             # Supervise studio:ingest, corrige inventory.json si détection ratée.
│       │                            # Outils : Bash, Read, Write. Ne charge JAMAIS le PDF entier (R9)
│       ├── art-director.md          # Covers + illustrations. Charge skills/cover-design. Concepts écrits
│       │                            # AVANT génération. Outils : Read, Write, Bash, MCP Higgsfield
│       ├── layout-designer.md       # chapters/<n>.md → html/<n>.html. APPLIQUE page-plan.json (ne re-décide
│       │                            # pas à l'œil). Écrit les briefs visuels. Ne modifie jamais le texte (R2)
│       ├── infographic-designer.md  # Briefs → SVG dans visuals/, patterns de skills/infographics
│       │                            # uniquement + tokens du projet. Outils : Read, Write
│       ├── bonus-productizer.md     # bonuses/raw/ → livrables finaux. Demande les mini-covers
│       │                            # à l'art-director. Outils : Read, Write, Bash
│       └── qa-reviewer.md           # Lance studio:qc D'ABORD, puis inspecte les previews/ PNG par lots.
│                                    # Produit qa-report.md GO/NO-GO. Outils : Read, Bash
│                                    # → Chaque agent finit par : résumé + question de validation.
│                                    #   Aucun agent n'enchaîne de lui-même (R6)
│
├── skills/                          # LE SAVOIR-FAIRE — chargé à la demande (7 skills)
│   ├── pdf-ingest/SKILL.md          # Stratégie extraction, nommage chapitres, bonus hors du corps,
│   │                                # inventory.json = source de vérité unique
│   ├── design-system/SKILL.md       # brand-input → tokens.css ; WCAG ; échelle typo ;
│   │                                # ★ MATIÈRE : associations polices par niche
│   ├── cover-design/SKILL.md        # ★★ LE skill critique. MATIÈRE : codes Kindle US par niche,
│   │                                # règle titre court/long, test thumbnail 100px, specs sortie
│   ├── chapter-layout/SKILL.md      # Anatomie chapitre premium, règles d'insertion callouts,
│   │                                # densité 1 visuel / 2-3 pages, applique le plan
│   ├── infographics/SKILL.md        # ★★ MATIÈRE : 7 patterns SVG avec code de base paramétré tokens
│   ├── bonus-productizer/SKILL.md   # ★ MATIÈRE : formats livrables (checklist, worksheet fillable,
│   │                                # template Notion), mini-cover + "$X value"
│   └── pdf-assembly/SKILL.md        # Ordre canonique des pages, pagination romains/arabes,
│                                    # TOC via Paged.js target-counter, checklist pré-export
│
├── src/                             # LE MOTEUR (TypeScript) — la fiabilité vit ici
│   ├── ingest/index.ts              # PDF → markdown par chapitre + inventory.json (pdfjs-dist,
│   │                                # SHA-256 du source, détection CHAPTER/Introduction/BONUS, fallback)
│   ├── audit/index.ts               # Détection : titres dupliqués, caractères cassés, pages quasi vides,
│   │                                # listes malformées → reports/content-audit.md
│   ├── plan/index.ts                # Segmentation blocs → composants. Règles DÉTERMINISTES d'abord,
│   │                                # 1 seul appel modèle max par chapitre pour les ambigus
│   │                                # → design/page-plan.json + reports/plan-coverage.md
│   ├── design/index.ts              # brand-input + thème → tokens.css ; merge config
│   │                                # defaults → preset → generated → user → resolved (validé schéma)
│   ├── render/index.ts              # HTML → Paged.js → Playwright → PDF + previews/ PNG par page.
│   │                                # Attend fonts.ready + événement "rendered" de Paged.js
│   ├── qc/
│   │   ├── run.ts                   # Exécute tous les checks, écrit qc-report.json/.md,
│   │   │                            # exit non-zéro à la moindre faille, enregistre dans build-state
│   │   └── checks/                  # UN fichier par gate → {id, pass, evidence} :
│   │       ├── fonts-embedded.ts    # toutes les polices embarquées
│   │       ├── text-coverage.ts     # ≥95% des caractères source dans la couche texte
│   │       ├── no-broken-chars.ts   # zéro U+FFFD, zéro "(cid:"
│   │       ├── ink-coverage.ts      # pages 2%-62% d'encre
│   │       ├── no-overflow.ts       # aucun débordement >2px (mesuré Playwright post-pagination)
│   │       ├── min-font-size.ts     # corps ≥9.5pt
│   │       ├── contrast.ts          # contraste corps ≥4.5:1
│   │       ├── assets-exist.ts      # tout asset référencé existe
│   │       ├── image-dpi.ts         # ≥150dpi effectif, upscale ≤120%
│   │       ├── outline-toc.ts       # outline = nb chapitres, tout lien TOC résout
│   │       ├── metadata.ts          # XMP title/author/lang=en-US
│   │       ├── file-size.ts         # PDF screen <15 MB
│   │       ├── no-bonus-in-body.ts  # zéro section BONUS restante dans le corps
│   │       └── structure.ts         # chaque chapitre d'inventory a son rendu
│   │                                # + score esthétique /100 (ne gate rien, note à l'humain)
│   ├── providers/                   # IMAGE-GEN — la seule porte vers la génération d'images (R4)
│   │   ├── types.ts                 # Interface ImageProvider {generate(request)} — swappable
│   │   └── higgsfield/index.ts      # Impl active via MCP : sauvegarde images, generation-log.json
│   │                                # (modèle, prompt exact), conversion specs (1600x2560 + 6x9 300dpi)
│   └── cli/index.ts                 # Entrées commander → scripts npm. Valide args, exit codes,
│                                    # persiste tout dans state/build-state.json (R8)
│
├── schemas/                         # JSON Schemas — validés avant tout build
│   ├── inventory.schema.json
│   ├── page-plan.schema.json
│   ├── project-config.schema.json
│   └── qc-report.schema.json
│
├── config/
│   └── defaults.yaml                # Valeurs par défaut (format 6x9, marges, langue en-US)
│
├── themes/                          # Directions esthétiques réutilisables entre ebooks
│   └── default/
│       ├── tokens.json              # Palette + polices neutres de départ
│       └── theme.css                # Surcharges du thème
│
├── templates/                       # LE MOTEUR VISUEL — HTML/CSS → "vrai livre premium US"
│   ├── base.css                     # @page 6x9, marges 0.75in ext / 0.9in int, folios, running header,
│   │                                # échelle typo (corps 11pt, interligne 1.55), orphans/widows ≥3,
│   │                                # drop caps, callouts, pull quotes, tableaux zébrés —
│   │                                # TOUT en var(--*), zéro couleur/police en dur (R7)
│   ├── tokens.template.css          # Variables à instancier par projet, commentées
│   ├── chapter.html                 # {{CHAPTER_NUMBER}} {{CHAPTER_TITLE}} {{CONTENT}} — ouverture élégante
│   ├── frontmatter/
│   │   ├── title-page.html
│   │   ├── copyright.html           # + bloc {{NICHE_DISCLAIMER}} conditionnel (finance = obligatoire)
│   │   ├── toc.html                 # Cliquable, points de conduite, numéros via target-counter (natif)
│   │   └── bonus-teaser.html        # "Included with this book" — valeur perçue avant lecture
│   ├── backmatter/
│   │   ├── cta.html                 # {{CTA_CONTENT}} : accès bonus, communauté, offre
│   │   └── back-cover.html          # Fond primaire, punchline + 3 bullets + branding
│   └── components/                  # UN partial par composant de l'enum du plan :
│       ├── process-steps.html
│       ├── checklist.html
│       ├── comparison-table.html
│       ├── calculation-card.html
│       ├── warning-callout.html
│       ├── tip-callout.html
│       ├── key-takeaways.html
│       ├── pull-quote.html
│       └── figure.html              # Cadre standard des infographies + légende
│
├── brand/
│   └── brand-input.template.md      # Formulaire vierge copié dans chaque projet par /design-system :
│                                    # niche, titre, lecteur cible, palette hex, polices, ton, disclaimer.
│                                    # (Les assets d'un ebook — logo, etc. — vont dans son projet,
│                                    #  workspace/projects/<slug>/assets/, PAS ici.)
│
├── assets/fonts/                    # Polices OFL vendorées + licences (R10)
│   ├── literata/                    # Corps (serif)
│   ├── inter/                       # Titres / UI (sans)
│   └── jetbrains-mono/              # Figures / code
│
├── workspace/projects/              # UN DOSSIER PAR EBOOK (contenu hors git)
│   └── <slug>/
│       ├── source/original.pdf      # 📥 INPUT : sortie brute Synthesise AI — jamais éditée (R1)
│       ├── brand-input.md           # 📥 INPUT : brand remplie (créée par /design-system ou par toi)
│       ├── assets/                  # 📥 INPUT optionnel : logo, polices spécifiques à cet ebook
│       ├── inventory.json           # Structure détectée — source de vérité
│       ├── content/chapters/        # 00-introduction.md, 01-<titre>.md, ...
│       ├── bonuses/raw/             # Bonus extraits à l'ingestion
│       ├── bonuses/<bonus-slug>/    # Livrables finaux brandés
│       ├── config/                  # generated / user / resolved .yaml
│       ├── design/                  # tokens.css + page-plan.json
│       ├── visuals/                 # briefs/ + SVG + ambient/ (Higgsfield validées)
│       ├── cover/                   # concepts/ + final/ + generation-log.json
│       ├── html/                    # Chapitres maquettés (intermédiaire)
│       ├── previews/                # PNG par page (pour QC + gate humaine)
│       ├── reports/                 # content-audit, plan-coverage, qc-report, content-changes
│       ├── state/build-state.json   # Exit codes de chaque stage — la preuve (R8)
│       └── output/                  # ebook-final.pdf + cover 1600x2560
│
├── tests/
│   ├── sample/mini-source.pdf       # Fixture 3 pages (Intro / CHAPTER 01 / BONUS)
│   └── smoke-test.md                # Checklist post-clone d'un associé
│
└── docs/
    ├── implementation-plan.md       # Ce qui existe / manque / ordre de build
    └── onboarding.md                # Clone → premier /pipeline en 5 étapes
```

## Les 10 règles non négociables (à inscrire dans CLAUDE.md)

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

## Flux du pipeline (qui fait quoi)

| # | Command | Agent | Skills | Gate humaine |
|---|---------|-------|--------|--------------|
| 1 | `/ingest` | extractor | pdf-ingest | Valider découpage chapitres + bonus |
| 2 | `/design-system` | layout-designer | design-system | Valider tokens + page d'échantillon |
| 3 | `/cover` | art-director (+ MCP Higgsfield) | cover-design | Choisir parmi 3-4 concepts, itérer |
| 4 | `/chapter <n>` | layout-designer + infographic-designer | chapter-layout, infographics | Preview PDF → OK / retouches |
| 5 | `/bonus-extract` | bonus-productizer | bonus-productizer | Valider chaque livrable |
| 6 | `/assemble` | — (moteur) | pdf-assembly | Feuilleter le PDF complet |
| 7 | `/qa` | qa-reviewer | — | Gates QC + rapport → GO/NO-GO |

`/pipeline <slug>` enchaîne 1→7 en s'arrêtant à chaque gate (mode associés).
