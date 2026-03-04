# 대시보드

`http://127.0.0.1:4200`에서 접근 가능한 웹 기반 관리 UI입니다.

**React + Vite**로 구축. **한국어/영어 i18n** 지원 (브라우저 로케일 자동 감지). CSS 디자인 토큰 시스템(`var(--sp-*)`, `var(--fs-*)`, `var(--line)`, `var(--radius-*)`)으로 일관된 테마 제공.

전역 상태 관리는 Zustand (`store.ts`) — SSE 연결 상태, 사이드바, 테마, 웹 스트리밍.

사이드바에서 7개 섹션으로 이동합니다. 하단 버튼으로 다크/라이트 테마를 전환할 수 있습니다.

## Setup Wizard

첫 실행 시 프로바이더가 설정되지 않으면 자동으로 `/setup`으로 리디렉트됩니다.

| 단계 | 내용 |
|------|------|
| 1 | AI 프로바이더 선택 + API 키 입력 |
| 2 | 기본 executor/orchestrator 선택 |
| 3 | 에이전트 alias 입력 |
| 4 | 완료 → 1.5초 후 Overview로 이동 |

## 페이지 구성

| 페이지 | 경로 | 기능 |
|--------|------|------|
| Overview | `/` | 런타임 상태 요약, 시스템 메트릭, SSE 실시간 피드 |
| Workspace | `/workspace` | 메모리·세션·스킬·크론·도구·에이전트·템플릿·OAuth 관리 (8탭) |
| Chat | `/chat` | 웹 기반 에이전트 대화 (마크다운 렌더링 + 코드 하이라이팅) |
| Channels | `/channels` | 채널 연결 상태 · 글로벌 설정 |
| Providers | `/providers` | 에이전트 프로바이더 CRUD |
| Secrets | `/secrets` | AES-256-GCM 시크릿 관리 |
| Settings | `/settings` | 글로벌 런타임 설정 (섹션 탭, 인라인 편집, ToggleSwitch) |

## Overview

런타임 전체 상태를 한눈에 확인합니다.

| 섹션 | 내용 |
|------|------|
| **통계 카드** | 활성 에이전트 수 · 실행 중 프로세스 · 연결된 채널 |
| **Performance** | CPU · 메모리 · Swap 사용률 (프로그레스 바) |
| **Network** | 네트워크 수신/송신 속도 (KB/s) — Linux 환경에서만 표시 |
| **에이전트** | 역할별 상태 배지 · 마지막 메시지 시간 |
| **실행 중인 프로세스** | run_id · 모드 · 도구 호출 수 · 에러 여부 |
| **크론** | 활성 크론 잡 (잡 있을 때만 표시) |
| **결정사항** | 주요 결정 키-값 (결정 있을 때만 표시) |
| **최근 이벤트** | 워크플로우 이벤트 스트림 |

## Workspace 탭 상세

Workspace는 8개 탭으로 구성됩니다.

### Memory
에이전트의 메모리와 DB 기반 기록을 조회/편집합니다.

| 항목 | 내용 |
|------|------|
| **Long-term** | 장기 메모리 (편집 가능) |
| **Daily** | 날짜별 일일 노트 (편집 가능) |
| **Decisions** | DB에 저장된 결정사항 목록 |
| **Promises** | DB에 저장된 약속 목록 (추가/삭제 가능) |
| **Events** | DB에 저장된 워크플로우 이벤트 스트림 |

### Sessions
대화 세션 목록과 히스토리를 조회합니다.
- **채널 필터 칩**: 전체 / Slack / Telegram / Discord / Web 탭으로 프로바이더별 필터링
- 세션 클릭 → 프로바이더 배지 + 타임스탬프 포함 전체 메시지 히스토리

### Skills
에이전트 스킬 목록과 파일을 확인/편집합니다.
- **builtin 스킬**: 읽기 전용 (내장 역할 스킬)
- **workspace 스킬**: `SKILL.md` 및 `references/` 파일 직접 편집 가능
- 파일 탭 전환, 편집 후 Save 버튼으로 저장
- 저장 즉시 에이전트에 반영 (재시작 불필요)
- **도구 피커** (`SKILL.md` 편집 시 자동 표시)
  - `도구:` — SoulFlow 레지스트리 도구 칩 클릭 → `tools:` frontmatter 토글
  - `SDK:` — Bash · Read · Write · Edit 등 네이티브 도구
  - `OAuth:` — 등록된 OAuth 서비스 → `oauth:` frontmatter 토글
  - `역할 프리셋:` — 역할 버튼 클릭 → 해당 역할 도구 세트 일괄 병합

### Cron
크론 잡을 관리합니다.
- 잡 목록 · 활성/비활성 상태 · 다음 실행 시간
- 잡 추가/수정/삭제 · Run Now(즉시 실행)

### Tools
에이전트가 사용 가능한 도구 목록을 조회합니다.
- 도구명 · 소스 · 파라미터 수
- **행 클릭** → 파라미터 테이블 펼치기 (이름 · 타입 · 필수 여부 · 설명)

### Agents
에이전트 설정을 관리합니다.
- 에이전트 목록 · 역할 · 백엔드
- 추가/수정/삭제

### Templates
시스템 프롬프트 템플릿을 편집합니다.
- 편집 가능 파일: `IDENTITY` · `AGENTS` · `SOUL` · `HEART` · `USER` · `TOOLS` · `HEARTBEAT`
- 저장 후 다음 에이전트 실행 시 즉시 반영

### OAuth
OAuth 2.0 외부 서비스 연동 관리 → [OAuth 가이드](./oauth.md) 참고

## Chat 페이지

Slack/Telegram 없이 웹에서 에이전트와 직접 대화합니다.

- **마크다운 렌더링**: GFM 완전 지원 (헤딩, 볼드, 리스트, 테이블, 인용)
- **코드 하이라이팅**: 펜스드 코드블록 언어별 구문 강조 (`highlight.js`)
- **보안**: `rehype-sanitize`로 `<script>`, `<iframe>`, `javascript:` URL 등 XSS 차단
- **스트리밍**: 에이전트 스트리밍 중 부분 마크다운 점진적 렌더링
- **승인 배너**: 도구 승인 요청 시 인라인 승인/거부 UI
- **미디어 프리뷰**: 첨부파일 인라인 렌더링
- **에이전트 선택**: 설정된 에이전트 간 전환

## Providers 페이지 주요 기능

에이전트 백엔드를 추가/수정/삭제하고 연결을 테스트합니다.

1. **Add** — 새 프로바이더 추가 (타입, 토큰, 우선순위, 지원 모드 설정)
2. **Edit** — 기존 프로바이더 설정 수정
3. **Test** — 실제 API 호출로 연결 확인
4. **Remove** — 프로바이더 삭제

서킷 브레이커 상태(`closed` / `half_open` / `open`)는 카드 배지로 표시됩니다.

## Secrets 페이지

AES-256-GCM으로 암호화된 민감정보를 관리합니다.
- 시크릿 목록 (값은 가려짐)
- 추가 · 삭제 · Reveal (복호화 확인)
- 에이전트는 참조명으로만 접근 — 실제 값은 도구 실행 경로에서만 복호화

## 실시간 피드

Overview 페이지는 SSE(Server-Sent Events)로 실시간 이벤트를 표시합니다. `SseManager`가 7종 이벤트를 브로드캐스트합니다:

| SSE 이벤트 | 용도 |
|-----------|------|
| `process` | 실행 시작/종료 |
| `message` | 인바운드/아웃바운드 메시지 (최근 40개 유지) |
| `cron` | 크론 잡 이벤트 |
| `progress` | 진행 상황 |
| `task` | 태스크 상태 변경 |
| `web_stream` | 웹 채팅 스트리밍 |
| `agent` | 에이전트 이벤트 (slim 필드만) |

## 백엔드 아키텍처

대시보드 백엔드는 다음 서비스로 분리되어 있습니다:

| 서비스 | 역할 |
|--------|------|
| `RouteContext` | 라우트 핸들러 공통 컨텍스트 (req/res + `json()`, `read_body()`, `add_sse_client()` 등 액션 함수) |
| `SseManager` | SSE 클라이언트 관리 + 7종 이벤트 브로드캐스트 |
| `StateBuilder` | 대시보드 상태 순수 조립 함수 (`build_dashboard_state`, `build_merged_tasks`) |
| `StaticServer` | SPA 정적 자산 서빙 + `index.html` fallback (html: no-store, 나머지: immutable) |
| `MediaTokenStore` | 토큰 기반 미디어 서빙 (workspace 외부 경로 차단, 1시간 TTL) |
| `OpsFactory` | 11개 도메인별 ops 객체 팩토리 (template, channel, agent-provider, bootstrap, memory, workspace, oauth, config, skill, tool, cli-auth) |

22개 라우트 핸들러가 `src/dashboard/routes/`에 분리되어 있으며, 각 라우트는 `async (ctx: RouteContext) => boolean` 패턴을 따릅니다.

## 접근 제한

기본적으로 `127.0.0.1`에만 바인딩됩니다. 외부 접근이 필요하면 대시보드 → **Settings** → `dashboard` 섹션에서 호스트와 포트를 변경하세요.

> **주의**: 외부 바인딩은 인증 없이 공개됩니다.

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| 접속 불가 | Settings에서 포트 변경 또는 포트 충돌 프로세스 종료 |
| 실시간 피드 끊김 | 브라우저 새로고침, 방화벽/프록시 SSE 차단 확인 |
| 설정 저장 안 됨 | 파일 권한 확인 (`workspace/templates/` 쓰기 권한) |

## 관련 문서

→ [프로바이더 설정](./providers.md)
→ [OAuth 연동](./oauth.md)
→ [Heartbeat 설정](./heartbeat.md)
