---
description: Run the full 7-step pipeline for a project, resuming from state/build-state.json, stopping at every human gate.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /pipeline — guided mode

`$ARGUMENTS` is the project slug. This command chains `/ingest` → `/design-system` → `/cover` → `/chapter <n>` (for every chapter) → `/bonus-extract` → `/assemble` → `/qa`, stopping at each step's human gate. It never auto-advances past a gate on its own (R6) — it resumes on your next message once you answer the current gate's question.

## Steps

1. Read `workspace/projects/$ARGUMENTS/state/build-state.json` if it exists (`npm run studio:status -- --project $ARGUMENTS` also prints it). This tells you which stages already have a recorded `"success"` result — resume from the first stage that is missing, `"failed"`, or `"not_implemented"`, don't restart from step 1 if earlier stages already succeeded.
2. If `inventory.json` exists, also use it to compute chapter count for the step 4 loop and progress display.
3. Announce progress before each step as **"Step X/7: `<command>`"** using this numbering:

   | Step | Command | Gate |
   |---|---|---|
   | 1/7 | `/ingest` | Chapter + bonus split confirmed |
   | 2/7 | `/design-system` | Tokens + sample page confirmed |
   | 3/7 | `/cover` | Concept chosen, then final cover approved |
   | 4/7 | `/chapter <n>` (once per chapter) | Each chapter's preview OK'd |
   | 5/7 | `/bonus-extract` | Each bonus deliverable approved |
   | 6/7 | `/assemble` | Assembled PDF flipped through and approved |
   | 7/7 | `/qa` | GO/NO-GO verdict acknowledged |

4. Run each step's full procedure (as defined in its own command file) in order. After a step's agent asks its validation question, **stop and wait** — do not invoke the next step's agent until the human has replied to the current gate.
5. Step 4 repeats once per chapter in `inventory.json`'s `chapters[]` order — track and announce which chapter within step 4/7 (e.g. "Step 4/7: chapter 3 of 9").
6. If any step's underlying command reports a real failure or a NOT-YET-IMPLEMENTED engine stage (e.g. `studio:build`, `studio:audit`), stop the whole pipeline there and report it plainly — never skip a step or fabricate its result to keep the progress bar moving (R8).

## On resume

If invoked again for a project already partway through, skip every stage already recorded as `"success"` in `build-state.json`, announce which step you're resuming at, and continue from there.
