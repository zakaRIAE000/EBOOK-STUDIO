---
description: Compose cover, front matter, every validated chapter, bonus teaser, and back matter into the final PDF, in canonical order.
argument-hint: <slug>
allowed-tools: Bash, Read
---

# /assemble — Step 6/7

`$ARGUMENTS` is the project slug. No agent — this is the engine, driven by `skills/pdf-assembly/SKILL.md`'s canonical order. Requires every chapter to have passed its `/chapter <n>` gate and every bonus to have passed its `/bonus-extract` gate.

## Steps

1. Walk `skills/pdf-assembly/SKILL.md`'s pre-export checklist before running anything: every chapter in `inventory.json` has an approved `html/<n>.html`, cover assets exist at both specs (1600x2560 Kindle + 6x9in@300dpi print), the disclaimer block is present if the niche requires it, and bonus deliverables exist if `bonuses[]` is non-empty.
2. Run `npm run studio:build -- --project $ARGUMENTS`. This composes the canonical order (cover → title page → copyright/disclaimer → bonus teaser → TOC → chapters in inventory order → CTA → back cover) into the assembled PDF and persists the stage result to `state/build-state.json` (R8).
3. **If the CLI reports `studio:build` is not yet implemented** (exit code 2, `status: "not_implemented"` in `build-state.json`), stop and report that plainly to the human — do not describe an assembled PDF that wasn't actually produced. This is the truthful current state of the engine, not something to paper over.

## Validation gate (human, required)

Once a real assembled PDF exists: **"Assembled PDF is at `<path>` — please flip through it. OK to move to /qa, or does something need fixing?"**

Do not proceed to `/qa` until the human has actually looked at the assembled book and confirmed.
