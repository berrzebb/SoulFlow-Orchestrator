# Design: Container Code Runner — Multi-Language Container Sandbox Execution

> **Status**: Implementation complete

## Overview

Extends the Code node from JavaScript/Shell-only to **7 languages** (Python, Ruby, Bash, Go, Rust, Deno, Bun).
Runs in podman/docker containers in one-shot or persistent sandbox mode.

## Problem

The existing Code node only supported `vm` module (JavaScript) and `child_process` (Shell).
Python data processing, Go performance logic, etc. could not run directly in workflows.
Container PTY infrastructure already exists, enabling language-agnostic sandboxed execution.

## Architecture

### 3 Execution Paths

```
Code Node (code.ts)
├── language: "javascript"  → vm sandbox (existing)
├── language: "shell"       → child_process (existing)
└── language: python|ruby|bash|go|rust|deno|bun
    → container-code-runner.ts
    → podman/docker run --rm (one-shot)
    → or named container + exec (persistent)
```

### Security Constraints

| Constraint | Value |
|-----------|-------|
| Network | `--network=none` (default, opt-in to allow) |
| Filesystem | `--read-only` + `/tmp` tmpfs (64MB) |
| Memory | `--memory=256m` |
| CPU | `--cpus=1` |
| Workspace | `-v workspace:/workspace:ro` (read-only) |
| Code mount | `-v tmpdir:/code:ro` |

### Runtime Mapping

| Language | Image | Extension | Command |
|----------|-------|-----------|---------|
| python | `python:3.12-slim` | `.py` | `python3 script.py` |
| ruby | `ruby:3.3-slim` | `.rb` | `ruby script.rb` |
| bash | `bash:5` | `.sh` | `bash script.sh` |
| go | `golang:1.22-alpine` | `.go` | `go run script.go` |
| rust | `rust:1.77-slim` | `.rs` | `rustc script.rs -o /tmp/out && /tmp/out` |
| deno | `denoland/deno:2.0` | `.ts` | `deno run --allow-all script.ts` |
| bun | `oven/bun:1` | `.ts` | `bun run script.ts` |

### Execution Modes

**One-shot** (`keep_container: false`, default):
```
podman run --rm --network=none --memory=256m ... python:3.12-slim python3 /code/script.py
```

**Persistent** (`keep_container: true`):
```
podman run -d --name code-xxx ... python:3.12-slim sleep 3600
podman exec code-xxx python3 /code/script.py
```
Reuses the same container to save image pull + initialization cost.

### Container Engine Detection

Auto-detects podman → docker in order, caches result. Errors if neither available.

## Type Extensions

```typescript
// workflow-node.types.ts
type CodeLanguage =
  | "javascript" | "shell"
  | "python" | "ruby" | "bash" | "go" | "rust" | "deno" | "bun";

interface CodeNodeDefinition extends NodeBase {
  node_type: "code";
  language: CodeLanguage;
  code: string;
  timeout_ms?: number;
  container_image?: string;   // Image override
  network_access?: boolean;   // Allow network
  keep_container?: boolean;   // Keep container alive
}
```

## File Structure

```
src/agent/
  workflow-node.types.ts       # CodeLanguage extension, CodeNodeDefinition
  nodes/
    code.ts                    # 3 execution path dispatch (JS/Shell/Container)
    container-code-runner.ts   # Container execution engine

web/src/pages/workflows/
  nodes/code.tsx               # 9 language options + container settings UI
```

## Related Documents

→ [Node Registry](./node-registry.md) — 27-node registration architecture
→ [PTY Agent Backend](./pty-agent-backend.md) — Container infrastructure
