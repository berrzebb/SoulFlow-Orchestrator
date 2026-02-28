---
name: tmux
description: Remote-control tmux sessions for interactive CLIs by sending keystrokes and scraping pane output. Use when the task needs an interactive TTY: Python REPLs, long-running processes, or orchestrating multiple agents in parallel. Requires tmux on PATH (macOS/Linux, WSL on Windows). Do NOT use for simple non-interactive commands (use just-bash).
metadata:
  model: local
  tools:
    - exec
  triggers:
    - tmux
    - 터미널
    - 세션
---

# tmux Skill

## Quick Reference

| Task | Command |
|------|---------|
| New session | `tmux -S "$SOCKET" new -d -s "$SESSION" -n shell` |
| Send keys | `tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- '...' Enter` |
| Capture output | `tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -200` |
| List sessions | `tmux -S "$SOCKET" list-sessions` |
| Kill session | `tmux -S "$SOCKET" kill-session -t "$SESSION"` |

Requires `tmux` on PATH (macOS/Linux, WSL on Windows).

## Quickstart

```bash
SOCKET_DIR="${ORCH_TMUX_SOCKET_DIR:-${TMPDIR:-/tmp}/orchestrator-tmux-sockets}"
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/orchestrator.sock"
SESSION=orchestrator-python

tmux -S "$SOCKET" new -d -s "$SESSION" -n shell
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'PYTHON_BASIC_REPL=1 python3 -q' Enter
```

After starting, always print monitor commands for the user.

## Key Conventions

- **Socket**: `ORCH_TMUX_SOCKET_DIR` env var or `${TMPDIR}/orchestrator-tmux-sockets/orchestrator.sock`.
- **Target format**: `session:window.pane` (defaults to `:0.0`). Keep names short, no spaces.
- **Literal sends**: `send-keys -t target -l -- "$cmd"` (use `-l` for safety).
- **Python REPLs**: set `PYTHON_BASIC_REPL=1` (non-basic REPL breaks send-keys).

## Parallel Agent Orchestration

```bash
SOCKET="${TMPDIR:-/tmp}/codex-army.sock"

for i in 1 2 3; do
  tmux -S "$SOCKET" new-session -d -s "agent-$i"
done

tmux -S "$SOCKET" send-keys -t agent-1 "cd /tmp/project1 && codex --yolo 'Fix bug X'" Enter
tmux -S "$SOCKET" send-keys -t agent-2 "cd /tmp/project2 && codex --yolo 'Fix bug Y'" Enter
```

Poll for completion by checking shell prompt in `capture-pane` output.

## Prompt-Wait Pattern

```bash
for i in $(seq 1 20); do
  tmux -S "$SOCKET" capture-pane -p -J -t session:0.0 -S -200 | grep -q "DONE" && break
  sleep 0.5
done
```

## Cleanup

- Kill session: `tmux -S "$SOCKET" kill-session -t "$SESSION"`
- Kill all: `tmux -S "$SOCKET" kill-server`
