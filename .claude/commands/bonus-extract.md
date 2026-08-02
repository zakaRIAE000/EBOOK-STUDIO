---
description: Turn bonuses/raw/*.md into branded standalone deliverables (checklist, worksheet, or Notion template), validated one at a time.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /bonus-extract — Step 5/7

`$ARGUMENTS` is the project slug. Requires `/ingest` to have populated `inventory.json`'s `bonuses[]`. If it's empty, tell the human this project has no bonuses and skip straight to `/assemble`.

## Steps

1. Invoke the **bonus-productizer** agent with the project slug.
2. For each entry in `inventory.json`'s `bonuses[]`, the agent picks the matching format (checklist / fillable worksheet / Notion template) per `skills/bonus-productizer/SKILL.md`, requests a mini-cover from the **art-director** agent (never generates cover art itself — R4), and assigns a displayed dollar value.
3. Each finished deliverable lands in `bonuses/<bonus-slug>/`.

## Validation gate (human, required — per deliverable)

For each bonus: **"Does this deliverable for '<bonus title>' look right?"**

Validate each one individually, not as a batch — a bad worksheet shouldn't slip through because three good checklists were approved alongside it. Do not proceed to `/assemble` until every bonus has been explicitly approved.
