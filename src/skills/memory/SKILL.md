---
name: memory
description: Two-layer memory system with MEMORY.md + daily yyyy-mm-dd.md recall.
always: true
---

# Memory

## Structure

- `memory/MEMORY.md` — Long-term facts (preferences, project context, relationships). Always loaded into your context.
- `memory/yyyy-mm-dd.md` — Daily execution/context log (for example `memory/2026-02-23.md`).

## Search Past Events

```bash
rg -n "keyword" memory/*.md
```

Use the `exec` tool to run search. Combine patterns: `rg -n "meeting|deadline" memory/*.md`

## When to Update MEMORY.md

Write important facts immediately using `edit_file` or `write_file`:
- User preferences ("I prefer dark mode")
- Project context ("The API uses OAuth2")
- Relationships ("Alice is the project lead")

## Auto-consolidation

Old conversations are automatically summarized from recent `yyyy-mm-dd.md` files into `MEMORY.md` when sessions grow. Keep daily detail in date files and durable rules in `MEMORY.md`.
