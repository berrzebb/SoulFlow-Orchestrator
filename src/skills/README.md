# Builtin Skills

This directory contains built-in skills for the headless orchestrator runtime.

## Skill Format

Each skill is a directory containing a `SKILL.md` file with:
- YAML frontmatter (name, description, metadata)
- Markdown instructions for the agent

## Attribution

These skills are adapted from [OpenClaw](https://github.com/openclaw/openclaw)'s skill system.
The skill format and metadata structure follow OpenClaw's conventions to maintain compatibility.

## Available Skills

| Skill | Description |
|-------|-------------|
| `github` | Interact with GitHub using the `gh` CLI |
| `weather` | Get weather info using wttr.in and Open-Meteo |
| `summarize` | Summarize URLs, files, and YouTube videos |
| `tmux` | Remote-control tmux sessions |
| `clawhub` | Search and install skills from ClawHub registry |
| `skill-creator` | Create new skills |
| `agent-browser` | Browser automation and web research using web_search/web_fetch/web_browser |
| `just-bash` | Efficient shell workflow through exec with automatic just-bash runtime |
| `python-sandbox` | Temporary podman/docker Python execution with in-container virtual environment |
| `temp-db` | Ephemeral DB workflow (default PostgreSQL) with container start/query/cleanup |
| `diagram` | Mermaid diagram rendering using builtin diagram_render tool (@vercel/beautiful-mermaid) |
| `cron` | Cron job management via builtin cron tool |
| `file-delivery` | File delivery and export via send_file tool |
| `memory` | Long-term memory management via builtin memory tool |

## Roles (`roles/`)

역할 기반 서브에이전트 시스템. 각 역할은 `SKILL.md` + `resources/` 리소스로 구성.

| Role | Name | Description |
|------|------|-------------|
| `concierge` | `role:concierge` | 사용자 직접 대면. 일상 작업 처리, 개발 작업 감지 시 PM/PL에 위임 |
| `pm` | `role:pm` | 기획 전담. 요구사항 분석, 스펙 작성, 우선순위 결정 |
| `pl` | `role:pl` | 실행 조율. 개발팀 spawn, 진행 감독, Phase Gate 판정 |
| `generalist` | `role:generalist` | 범용 서브에이전트. 전문 역할이 불필요한 단일 작업 |
| `implementer` | `role:implementer` | 코드 구현 전문. 스펙 기반 파일 수정 + 셀프 검증 |
| `reviewer` | `role:reviewer` | 코드 리뷰 전문. 품질, 보안, 성능, 컨벤션 검토 |
| `debugger` | `role:debugger` | 디버깅 전문. 버그 추적, 근본 원인 분석(RCA) |
| `validator` | `role:validator` | 검증 전문. 빌드, 테스트, lint 실행 및 결과 판정 |

### 위임 계층

```
concierge (사용자 대면)
  ├── pm (기획 필요)
  │     └── pl (실행 위임)
  └── pl (즉시 실행)
        ├── implementer (구현)
        ├── reviewer (리뷰)
        ├── validator (검증)
        ├── debugger (디버깅)
        └── generalist (잡무)
```

## Shared Protocols (`_shared/`)

역할 간 공유 프로토콜. SKILL.md의 `shared_protocols` 필드로 참조.

| Protocol | Description |
|----------|-------------|
| `clarification-protocol` | 불확실성 분류 및 질문 판단 기준 |
| `session-metrics` | 세션 메트릭 수집/보고 규칙 |
| `phase-gates` | 단계별 체크포인트 통과 기준 |
| `difficulty-guide` | 작업 난이도 분류 및 턴 예산 배정 |
| `error-escalation` | 에러 시 에스컬레이션 절차 |
| `lang/typescript` | TypeScript 코드 컨벤션 |
| `lang/rust` | Rust 코드 컨벤션 |
