---
name: just-bash
description: Efficient shell execution workflow using the exec tool with automatic just-bash runtime.
always: true
---

# just-bash

Use this skill when fast local computation or command-line inspection is needed.

## Runtime Behavior

- Use the `exec` tool only.
- `exec` automatically uses `just-bash` when available.
- If `just-bash` is unavailable, it falls back to the native shell.

No extra environment variable is required.

## Recommended Flow

1. Prefer short, deterministic commands.
2. Start with read-only inspection (`rg`, `Get-ChildItem`, `Get-Content`, `git status`).
3. For transformations, keep commands single-purpose and easy to verify.
4. For write commands, summarize intent before execution and verify results immediately.

## Guardrails

- Avoid long interactive commands in `exec`.
- Avoid destructive commands unless explicitly requested.
- Keep commands scoped to the workspace path whenever possible.
