---
name: memory
description: Two-layer memory system with memory.db longterm + daily recall.
always: true
---

# Memory

## Structure

- `memory/memory.db` — Long-term and daily memory single source of truth.
- `sqlite://memory/longterm` — Long-term facts (preferences, project context, relationships).
- `sqlite://memory/daily/yyyy-mm-dd` — Daily execution/context memory.

## Search Past Events

Use the memory search API/tooling instead of markdown file scan.

## When to Update Longterm Memory

Write important facts immediately using memory tools:
- User preferences ("I prefer dark mode")
- Project context ("The API uses OAuth2")
- Relationships ("Alice is the project lead")

## Auto-consolidation

Old conversations are summarized from recent daily memory rows into longterm memory as sessions grow.
