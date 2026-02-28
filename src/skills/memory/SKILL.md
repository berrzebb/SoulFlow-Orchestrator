---
name: memory
description: Two-layer persistent memory system (longterm facts + daily recall) backed by memory.db. Use when the user mentions remembering, recalling past events, storing preferences, or asks about past context. Also use automatically to persist important user preferences, project facts, and relationship data. Do NOT use for ephemeral session data.
metadata:
  model: local
  always: true
  tools:
    - memory
  triggers:
    - 기억
    - 메모리
    - 기록
    - memory
---

# Memory

## Quick Reference

| Task | Tool Call |
|------|-----------|
| Store fact | `memory(action="store", scope="longterm", content="User prefers dark mode")` |
| Daily log | `memory(action="store", scope="daily", content="Deployed v2.1 to staging")` |
| Search | `memory(action="search", query="user preferences")` |
| Recall today | `memory(action="recall", scope="daily")` |

## Two-Layer Architecture

- **Longterm** (`sqlite://memory/longterm`) — persistent facts: preferences, project context, relationships.
- **Daily** (`sqlite://memory/daily/yyyy-mm-dd`) — execution logs, conversation context.

Both backed by `memory/memory.db`.

## Auto-Store Triggers

Store immediately when user reveals:
- Preferences ("I prefer dark mode")
- Project facts ("The API uses OAuth2")
- Relationships ("Alice is the project lead")

## Auto-Consolidation

Old daily memory rows are summarized into longterm as sessions grow.
