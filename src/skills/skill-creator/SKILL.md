---
name: skill-creator
description: Create, edit, and improve VaultGate skills. Use whenever the user wants to make a new skill, turn a workflow they just did into a reusable skill, fix or refactor an existing skill, or tighten a skill's description so it triggers reliably. Make sure to use this whenever the user says "make a skill", "turn this into a skill", or "improve this skill".
when_to_use: User wants to author, refactor, or tune a skill.
license: MIT
---

# Skill creator

Author skills that match VaultGate's native standard. A skill is a markdown instruction pack the agent loads on demand — knowledge and procedure, not code the app runs. Keep them tight: only the frontmatter loads up front; the body loads when the skill is invoked.

## The standard format

Every skill is a directory `skills/<name>/SKILL.md`, optionally with `scripts/` and reference docs alongside.

```markdown
---
name: kebab-case-name            # matches the directory name
description: <one line: WHAT it does + WHEN to trigger>   # the only trigger signal loaded up front
when_to_use: <short, concrete trigger phrases>            # optional but recommended
license: MIT
---

# Title

One or two sentences on what this does.

## Requirements (only if it needs a capability)
Capability gate + graceful failure instruction.

## Usage / How to
Concrete, agent-actionable steps. Reference bundled scripts by absolute path
using ${SKILL_DIR} (it resolves to this skill's own folder at load time).

## Tips
Sharp, specific guidance. Cross-link sibling skills by name.
```

### Rules that make a skill good

1. **Description is the trigger.** It must say *what* and *when*. Models under-trigger — be a little pushy: name the phrases/contexts that should fire it. All "when to use" lives in `description`/`when_to_use`, never buried in the body.
2. **Native to VaultGate.** Use the real runtime: the agent's tools (Bash, Read/Write/Edit, WebSearch, WebFetch, Open, Desktop, Skill), the `vaultgate` CLI, and npm/pip libraries. No hosted vendor APIs, no `bun`, no vendor branding. Bash starts at the workspace root and `cd` doesn't persist (chain with `&&`).
3. **Capability-gate anything that can fail.** If a skill needs a vision/image/audio model or an external tool, tell the agent to check first and, on failure, give the user one clear instruction and stop — never loop on errors.
4. **Progressive disclosure.** Keep SKILL.md lean. Push long references, tables, and examples into sibling files (`${SKILL_DIR}/reference.md`, `briefs/*.md`) and tell the agent to Read them on demand. Put runnable code in `scripts/`.
5. **`${SKILL_DIR}`** resolves to the skill's directory — use it to invoke bundled scripts (`npx tsx ${SKILL_DIR}/scripts/x.ts`, `python3 ${SKILL_DIR}/scripts/x.py`).
6. **Deliverables** go under `download/`; link them with `download/...` markdown links.

## Workflow

1. **Capture intent.** What should this enable? When should it trigger? What's the output? If the user just performed a workflow, extract the steps/tools/corrections from the conversation and confirm.
2. **Draft the SKILL.md** to the standard above. Start minimal; add only what earns its place.
3. **Add scripts/refs** if the skill needs deterministic code or long reference material.
4. **Test it.** Write 2–3 realistic prompts that should trigger the skill and a couple that should NOT. Run them mentally or live; check it triggers correctly and produces the intended output.
5. **Tune the description** for reliable triggering — add the missing phrases/contexts that failed to fire it.
6. **Iterate** with the user until it's sharp.

## Editing an existing skill

Read it first. Preserve working capability — clean and tighten rather than gut. Remove vendor cruft, fix placeholders to `${SKILL_DIR}`, sharpen the description, and split out anything long into reference files.

## Where skills live

`skills/<name>/` (bundled) and the user data dir's `skills/` (user-installed, takes precedence). Add a one-line entry to `skills/manifest.json` when creating a new skill. Skills are available in **agent** and **code** modes (chat mode has no Skill tool).
