---
description: Extract a project's source PDF into chapters + bonuses + inventory.json, and validate the split with a human.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /ingest — Step 1/7

`$ARGUMENTS` is the project slug (e.g. `mastering-cold-outreach`).

## Steps

1. Verify `workspace/projects/$ARGUMENTS/` exists and contains `source/original.pdf`. If the project directory doesn't exist yet, create `workspace/projects/$ARGUMENTS/source/` and tell the human to place the Synthesise AI PDF there before continuing — do not proceed without a real source file.
2. Invoke the **extractor** agent with the project slug. It will run `npm run studio:ingest -- --project $ARGUMENTS`, review `inventory.json` against `skills/pdf-ingest/SKILL.md`'s sanity checks, and hand-correct anything that's clearly wrong.
3. Persist the outcome: the extractor's run already writes `state/build-state.json` (stage `ingest`) via the CLI — do not fabricate or duplicate that record.

## Validation gate (human, required)

The extractor agent ends its run with the detected chapter + bonus table and asks: **"Does this chapter + bonus split look right?"**

Do not proceed to `/design-system` until the human explicitly confirms. If they ask for corrections, hand them back to the extractor agent — don't hand-edit `inventory.json` yourself outside that agent.
