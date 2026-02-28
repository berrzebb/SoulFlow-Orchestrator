---
name: python-sandbox
description: Execute Python code inside ephemeral containers (podman/docker) with automatic cleanup. Use when Python execution is needed but must not affect the host: data analysis, pip install, script testing. Container sandbox is mandatory. Do NOT run python or pip directly on host. Do NOT use for simple shell commands (use just-bash).
metadata:
  model: local
  tools:
    - exec
  triggers:
    - 파이썬
    - python
    - 코드 실행
    - 스크립트
  aliases:
    - python
---

# Python Sandbox

## Quick Reference

| Task | Command |
|------|---------|
| Run script | `$R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "pip install -r requirements.txt && python script.py"` |
| Run module | `$R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim python -m module_name` |
| Force cleanup | `$R rm -f $N` |

Container sandbox mandatory. Never run `python`/`pip` directly on host.

## Runtime Selection

`podman` first, fallback to `docker`. No host fallback.

```powershell
$R = if (Get-Command podman -ErrorAction SilentlyContinue) { "podman" } elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker" } else { throw "container_runtime_not_found" }
```

## Standard Run

```powershell
$N = "py-sbx-$([guid]::NewGuid().ToString('N').Substring(0,8))"
& $R run --rm --name $N -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -U pip && pip install -r requirements.txt && python your_script.py"
```

## Guardrails

- Always `--rm` so container is removed after run.
- Always install deps from `requirements.txt` inside container.
- On interruption, force cleanup: `& $R rm -f $N`
