---
name: clawhub
description: Search and install agent skills from ClawHub, the public skill registry. Use when the user asks to find, install, update, or list available skills. No API key needed. Do NOT use for creating skills (use skill-creator) or managing locally installed skills.
metadata:
  model: local
  tools:
    - exec
  triggers:
    - 스킬 설치
    - install skill
    - clawhub
  homepage: https://clawhub.ai
---

# ClawHub

Public skill registry for AI agents. Search by natural language (vector search).

## Quick Reference

| Task | Command |
|------|---------|
| Search | `npx --yes clawhub@latest search "topic" --limit 5` |
| Install | `npx --yes clawhub@latest install <slug> --workdir .` |
| Update all | `npx --yes clawhub@latest update --all --workdir .` |
| List installed | `npx --yes clawhub@latest list --workdir .` |

## Search

```bash
npx --yes clawhub@latest search "web scraping" --limit 5
```

## Install

```bash
npx --yes clawhub@latest install <slug> --workdir .
```

Replace `<slug>` with the skill name from search results. Install into your current workspace so files land under `skills/`.

## Update

```bash
npx --yes clawhub@latest update --all --workdir .
```

## List installed

```bash
npx --yes clawhub@latest list --workdir .
```

## Notes

- Requires Node.js (`npx` comes with it).
- No API key needed for search and install.
- Login (`npx --yes clawhub@latest login`) is only required for publishing.
- Use `--workdir <workspace-root>` so installed skills go to the active project.
- After install, remind the user to start a new session to load the skill.
