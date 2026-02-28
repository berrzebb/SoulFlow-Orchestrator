---
name: just-bash
description: Efficient shell execution using the exec tool with automatic just-bash runtime. Use for any local computation, file inspection, system commands, git operations, or CLI tools. Always available as the default execution pathway. Do NOT use for interactive TTY (use tmux) or container isolation (use python-sandbox or temp-db).
metadata:
  model: local
  always: true
  tools:
    - exec
  aliases:
    - bash
    - shell
    - 쉘
---

# just-bash

## Quick Reference

| Task | Example |
|------|---------|
| File search | `exec: rg "pattern" src/` |
| Git operation | `exec: git log --oneline -10` |
| System info | `exec: systeminfo` |
| File list | `exec: Get-ChildItem -Recurse *.ts` |

`exec` automatically uses `just-bash` runtime when available, native shell as fallback.

## Recommended Flow

1. Start with read-only inspection (`rg`, `Get-ChildItem`, `git status`).
2. Keep commands short, deterministic, single-purpose.
3. For write operations, summarize intent first and verify results after.

## Guardrails

- No long interactive commands (use tmux skill instead).
- No destructive commands unless explicitly requested.
- Scope commands to workspace path whenever possible.
