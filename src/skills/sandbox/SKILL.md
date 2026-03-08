---
name: sandbox
description: Execute any dependency-requiring task inside ephemeral containers (podman/docker) with automatic cleanup. Use for Python scripts (pip packages), SQLite/DuckDB local DB, PostgreSQL/MySQL connections, or any tool requiring system packages. Container is pulled, used, and removed — nothing stays on host. Do NOT use for simple shell commands with no external dependencies (use just-bash instead).
metadata:
  model: local
  always: true
  tools:
    - exec
    - Bash
    - write_file
  triggers:
    - 파이썬
    - python
    - 코드 실행
    - 스크립트
    - 데이터 분석
    - 계산
    - 변환
    - 크롤링
    - 데이터베이스
    - DB
    - postgres
    - mysql
    - sqlite
    - sql
  aliases:
    - python-sandbox
    - python
    - 파이썬
    - temp-db
    - database
    - 샌드박스
  intents:
    - execute_code
    - analyze_data
    - query_database
  code_patterns:
    - python
    - pandas
    - numpy
    - sqlite
    - sql
  checks:
    - 실행 결과에 에러나 예외가 없었나요?
    - 출력 데이터가 기대한 형식과 일치하나요?
    - 컨테이너가 정상적으로 종료되었나요?
---

# Sandbox

외부 의존성이 필요한 모든 작업은 컨테이너 안에서 실행한다.
컨테이너는 실행 후 자동 제거 — 호스트에 아무것도 남지 않는다.

## 상황별 레퍼런스

| 상황 | 이미지 | 파일 |
|------|--------|------|
| Python 스크립트, pip 패키지 | `python:3.12-slim` | [python.md](references/python.md) |
| SQLite 로컬 DB, CSV 분석 | `python:3.12-slim` | [sqlite.md](references/sqlite.md) |
| PostgreSQL / MySQL 연결 | `postgres:16` / `mysql:8` | [database.md](references/database.md) |
| 런타임 선택, 볼륨, 이미지 가이드 | — | [container-basics.md](references/container-basics.md) |

## 핵심 패턴

```bash
R=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
N="sbx-$(head -c4 /dev/urandom | xxd -p)"
$R run --rm --name "$N" -v "$PWD:/workspace:rw" -w /workspace <image> <command>
```

## Guardrails

- 항상 `--rm` — 컨테이너 자동 제거.
- pip/apt 등 모든 패키지 설치는 컨테이너 안에서만.
- 출력 파일은 `/workspace` 볼륨에 저장 (호스트 `PWD`와 공유됨).
- 인터럽트 시 강제 정리: `$R rm -f "$N"`
- 호스트에 직접 `python`, `pip`, `psql`, `mysql` 실행 금지.
