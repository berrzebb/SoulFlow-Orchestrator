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
  intents:
    - execute_code
    - read_file
    - write_file
  checks:
    - 실행 결과에 에러가 없었나요?
    - 파일 변경사항이 의도와 일치하나요?
---

# just-bash

## Quick Reference

| Task | Example |
|------|---------|
| File search | `exec: rg "pattern" src/` |
| Git operation | `exec: git log --oneline -10` |
| System info | `exec: uname -a` |
| File list | `exec: find . -name "*.ts" -type f` |

`exec` automatically uses `just-bash` runtime when available, native shell as fallback.

## Recommended Flow

1. Start with read-only inspection (`rg`, `ls`, `git status`).
2. Keep commands short, deterministic, single-purpose.
3. For write operations, summarize intent first and verify results after.

## References

- **[common-patterns.md](references/common-patterns.md)** — 파일 탐색, git, 텍스트 처리, 시스템, JSON, 네트워크 명령 패턴

## Guardrails

- No long interactive commands (use tmux skill instead).
- No destructive commands unless explicitly requested.
- Scope commands to workspace path whenever possible.
