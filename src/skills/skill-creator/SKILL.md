---
name: skill-creator
description: Create new skills, modify and improve existing skills, and validate skill structure. Use when users want to create a skill from scratch, update or optimize an existing skill, restructure SKILL.md for better triggering, or add scripts/references/assets. Do NOT use for general coding tasks, when the user just wants to use an existing skill, or when a builtin skill already covers the use case (check src/skills/ first).
metadata:
  model: remote
  tools:
    - read_file
    - write_file
    - edit_file
    - list_dir
    - exec
    - Bash
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
description: One-line what. Use when: (triggers). Do NOT use when: (exclusions).
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

### Step 0: Check for existing coverage

**반드시 먼저 실행.** 빌트인 스킬 목록을 확인하고 중복 여부를 판단한다.

```bash
# 빌트인 스킬 목록 확인
ls src/skills/
# 워크스페이스 스킬 목록 확인
ls workspace/skills/
```

요청된 기능이 기존 스킬로 이미 커버되면 **신규 생성 중단** — 사용자에게 기존 스킬을 안내한다.

| 확인 항목 | 빌트인 스킬 |
|----------|-----------|
| 파일 전송/첨부 | `file-delivery` |
| 파일 생성 (PDF/PPTX/DOCX/XLSX/ZIP) | `file-maker` |
| 웹 검색 | `agent-browser`, `web-search` (workspace) |
| 다이어그램 | `diagram` |
| 셸 실행 | `just-bash` |
| 메모리 | `memory` |
| 크론 | `cron` |
| GitHub | `github` |
| 날씨 | `weather` |
| 요약 | `summarize` |
| Python 실행 / DB 작업 / 컨테이너 실행 | `sandbox` |
| tmux | `tmux` |

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
2. **Register tools** — 스킬이 사용하는 **모든** 도구를 `tools:` 필드에 등록. 시스템 실행이 필요하면 `Bash` 포함 필수. 상세: [references/frontmatter-spec.md](references/frontmatter-spec.md) § Tools 등록 가이드
3. Write body — Quick Reference table first, then workflow steps
4. Add code examples — concise, ready to copy
5. Link references — `See [topic.md](references/topic.md) for details`

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
