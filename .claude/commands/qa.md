---
description: Run every deterministic QC gate, inspect previews for the aesthetic pass, and produce a GO/NO-GO verdict.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /qa — Step 7/7

`$ARGUMENTS` is the project slug. Requires `/assemble` to have produced an output PDF.

## Steps

1. Invoke the **qa-reviewer** agent with the project slug.
2. The agent runs `npm run studio:qc -- --project $ARGUMENTS` **first, always** — this is the only source of truth for whether the 14 deterministic gates (fonts, text coverage, broken chars, ink coverage, overflow, min font size, contrast, assets, image DPI, TOC/outline, metadata, file size, no bonus in body, structure) pass. A prose claim is never a substitute for this command's actual result (R8).
3. If any gate fails, the agent stops there and reports it — it does not proceed to visual inspection of a book already known to fail.
4. If all gates pass, the agent batches through `previews/*.png` (never the whole book at once — R9) for an aesthetic pass, and writes `reports/qa-report.md` with the full gate table, aesthetic score, and a GO/NO-GO verdict.

## Validation gate (human, required)

The agent ends with: **"QC verdict is `<GO/NO-GO>`, full report at `reports/qa-report.md`. Ready to treat this as final, or should I re-check after fixes?"**

A NO-GO means real fixes are needed upstream (back to the relevant `/chapter`, `/cover`, or `/bonus-extract` step) — never treat a NO-GO as something `/qa` itself can silently resolve. This is the last step of `/pipeline`; nothing auto-advances past a human's answer here.
