---
name: python-sandbox
description: Force Python execution inside an ephemeral container; install requirements.txt, run, and auto-remove container.
---

# Python Sandbox

Use this skill when Python execution must not affect the host environment.

## Policy

- Container sandbox is mandatory.
- Never run `python`/`pip` directly on host.
- Never install Python packages on host.
- Always run with `--rm` so container is removed immediately after run.
- Always install dependencies from `requirements.txt` inside container before execution.

## Runtime Selection

Use `podman` first, fallback to `docker`. If neither exists, fail the task (no host fallback).

```powershell
$R = if (Get-Command podman -ErrorAction SilentlyContinue) { "podman" } elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker" } else { throw "container_runtime_not_found" }
```

## Standard Run (requirements.txt -> execute -> remove)

```powershell
$N = "py-sbx-$([guid]::NewGuid().ToString('N').Substring(0,8))"
& $R run --rm --name $N -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -U pip && pip install -r requirements.txt && python your_script.py"
```

## Module/Inline Variant

```powershell
$N = "py-sbx-$([guid]::NewGuid().ToString('N').Substring(0,8))"
& $R run --rm --name $N -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -U pip && pip install -r requirements.txt && python -m your_module"
```

## Cleanup on Failure/Interrupt

If a run was interrupted, force cleanup:

```powershell
& $R rm -f $N 2>$null
```
