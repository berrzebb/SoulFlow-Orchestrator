---
name: skill-creator
description: Create new skills, modify and improve existing skills, and validate skill structure. Use when users want to create a skill from scratch, update or optimize an existing skill, restructure SKILL.md for better triggering, or add scripts/references/assets. Do NOT use for general coding tasks or when the user just wants to use an existing skill.
metadata:
  model: remote
  tools:
    - read_file
    - write_file
    - edit_file
    - list_dir
    - exec
  triggers:
    - 스킬 만들기
    - 스킬 생성
    - 스킬 수정
    - 스킬 개선
    - create skill
    - update skill
---

# Skill Creator

## Quick Reference

| Task | Approach |
|------|----------|
| Create new skill | Step 1-4 below |
| Improve description | See [references/frontmatter-spec.md](references/frontmatter-spec.md) |
| Improve body structure | See [references/body-patterns.md](references/body-patterns.md) |
| Add scripts | `scripts/` dir, test with `--help`, black-box execution |
| Add references | `references/` dir, link from SKILL.md body |
| Validate | Load through SkillsLoader + `npm run build` |

## Skill Anatomy

```
skill-name/
├── SKILL.md              (required — frontmatter + instructions)
├── scripts/              (deterministic code, executed as black-box)
├── references/           (loaded into context on demand)
└── assets/               (templates, images — used in output, not read)
```

## Frontmatter

Two standard fields + `metadata:` section for orchestrator routing.

```yaml
---
name: skill-name
description: >-
  One-line what. Use when: (triggers). Do NOT use when: (exclusions).
metadata:
  model: local | remote
  tools:
    - tool_name
  triggers:
    - 키워드
---
```

**Description is the primary trigger.** It must answer: What? When to use? When NOT to use?

For full field specification: [references/frontmatter-spec.md](references/frontmatter-spec.md)

## Core Principles

1. **Context = cost** — The agent is already smart. Only add what it can't know.
2. **Description > Body** — Body loads after triggering. All trigger info goes in description.
3. **Progressive disclosure** — Metadata (~100 words) → SKILL.md body (<500 lines) → references/ (unlimited).
4. **Scripts as black-box** — `run --help first`. Don't read source into context.

## Creation Process

### Step 1: Understand with examples

Ask the user for concrete usage scenarios. What would they say to trigger this skill?

### Step 2: Plan contents

For each scenario, identify: scripts (deterministic ops), references (domain knowledge), assets (templates).

### Step 3: Initialize

```bash
mkdir -p skills/<skill-name>/{scripts,references,assets}
```

Only create directories that will contain files.

### Step 4: Write SKILL.md

1. Write description — comprehensive, with "Use when" + "Do NOT use when"
2. Write body — Quick Reference table first, then workflow steps
3. Add code examples — concise, ready to copy
4. Link references — `See [topic.md](references/topic.md) for details`

Body patterns guide: [references/body-patterns.md](references/body-patterns.md)

### Step 5: Validate and iterate

Test the skill on real tasks. Notice struggles, update, repeat.

## Freedom Levels

Match specificity to fragility:

| Level | When | Example |
|-------|------|---------|
| High (text instructions) | Multiple valid approaches | "Analyze the webpage and summarize" |
| Medium (pseudocode/params) | Preferred pattern exists | "Run `scripts/convert.py --format pdf`" |
| Low (exact scripts) | Fragile, error-prone ops | "Execute exactly: `scripts/rotate.py -a 90 input.pdf`" |

## What NOT to Include

- README.md, CHANGELOG.md, INSTALLATION_GUIDE.md
- "When to Use This Skill" sections in body (belongs in description)
- User-facing documentation (skills are for agents, not humans)
- Placeholder files or empty directories
