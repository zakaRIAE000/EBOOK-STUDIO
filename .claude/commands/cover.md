---
description: Write 3-4 differentiated cover concepts, get a human pick, generate via Higgsfield CLI, and iterate to sign-off.
argument-hint: <slug>
allowed-tools: Agent, Bash, Read
---

# /cover — Step 3/7

`$ARGUMENTS` is the project slug. Requires `/design-system` to have completed (needs `config/resolved.yaml` for niche, palette, and title/subtitle).

## Steps

1. Invoke the **art-director** agent with the project slug.
2. The agent loads `skills/cover-design/SKILL.md` and `.claude/skills/higgsfield-generate/SKILL.md`, checks `higgsfield account status` before anything else, and writes 3–4 differentiated written concepts (concept, palette, composition, model, exact prompt) — **no generation call happens yet**.
3. Present the concepts to the human.

## Validation gate 1 (human, required)

**"Which concept should I generate — 1, 2, 3, 4, or a new direction?"** Nothing gets generated until this is answered — cost discipline is non-negotiable here.

4. Once a concept is chosen, the agent generates via the `higgsfield` CLI (never the MCP tool — see the agent's own doc for why), logs the call to `cover/generation-log.json`, and runs the 100px thumbnail legibility test on the result.
5. Iterate with the human on the chosen concept (palette/composition tweaks, regenerate) as many times as needed.

## Validation gate 2 (human, required)

**"Does this cover work, or what should I adjust?"**

Once approved, the agent produces the 1600x2560 Kindle version, the 6x9in@300dpi print version, and the back cover. Do not proceed to `/chapter` until the human explicitly signs off on the final cover.
