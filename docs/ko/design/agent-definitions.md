# 설계: Agent Gallery & Definition System — 에이전트 정의 및 갤러리

> **상태**: 설계 완료, 구현 진행 중

## 개요

사용자가 자신만의 에이전트를 정의하고, 갤러리에서 탐색·재사용할 수 있는 시스템. 기존 `src/skills/roles/*/SKILL.md`의 구조화된 frontmatter 형식을 그대로 UI 폼으로 노출하여, 명확한 역할과 경계를 가진 에이전트를 직접 또는 AI 보조를 통해 생성.

기존 `/workspace/agents`(런타임 모니터링)와 완전히 분리된 새 최상위 라우트 `/agents`.

## 문제

현재 에이전트 역할/행동 규칙은 `src/skills/roles/*/SKILL.md` 파일에만 존재:
- 사용자가 커스텀 에이전트를 만들려면 파일 시스템을 직접 편집해야 함
- 기존 role skill을 기반으로 변형하거나 확장할 UI가 없음
- 에이전트의 역할 경계(Do NOT use for...)가 암묵적으로만 정의됨
- 자연어로 에이전트를 설명하고 구조화된 정의로 변환하는 수단 없음

## 핵심 설계 원칙: Composed System Prompt

`AgentDefinition`은 파일이 아닌 DB에 저장되는 **SKILL.md equivalent**. 최종 시스템 프롬프트는 단일 텍스트가 아닌 레이어 합성:

```
[Shared Protocols]      ← 선택된 _shared/ 문서들 (공통 규칙)
        +
[Role SKILL.md body]    ← soul + heart + 역할 책임 정의
        +
[Tool Skills body]      ← 에이전트 능력 범위
        +
[use_when / not_use_for] ← 명시적 역할 경계
        +
[extra_instructions]    ← 커스텀 추가 지침
```

AI 생성 시에도 raw 텍스트 덩어리가 아닌 각 필드를 개별적으로 생성.

## 데이터 모델

### AgentDefinition

```typescript
type AgentDefinition = {
  id: string;
  name: string;
  description: string;   // "Use when X." 요약

  icon?: string;         // 이모지

  // SKILL.md frontmatter 대응 필드
  role_skill: string | null;     // 기반 role skill 이름 (e.g., "role:pm")
  soul: string;                  // 페르소나 — 성격/캐릭터
  heart: string;                 // 페르소나 — 행동 양식/어투
  tools: string[];               // 허용 도구 목록
  shared_protocols: string[];    // 포함할 _shared/ 프로토콜
  skills: string[];              // 추가 tool-type skill 목록

  // 경계 정의
  use_when: string;              // "Use when..." 상황 설명
  not_use_for: string;           // "Do NOT use for..." 금지 영역
  extra_instructions: string;    // 추가 커스텀 지시사항

  // 실행 설정
  preferred_providers: string[];
  model?: string;

  is_builtin: boolean;           // true = 읽기 전용 시스템 제공
  use_count: number;             // 사용 횟수
  created_at: string;
  updated_at: string;
};
```

**빌트인 에이전트** = 기존 `src/skills/roles/*/SKILL.md` 내용을 DB에 시드.
사용자가 복사하면 `is_builtin: false`인 커스텀 정의 생성.

### 공통 규칙 (Shared Protocols)

`src/skills/_shared/` 디렉토리의 프로토콜 문서들:

| 프로토콜 | 설명 |
|---------|------|
| `clarification-protocol` | 모호한 요청 분류 기준 (LOW/MEDIUM/HIGH) |
| `phase-gates` | 작업 단계 전환 체크리스트 |
| `error-escalation` | 에러 에스컬레이션 규칙 |
| `session-metrics` | 세션 메트릭 수집 기준 |
| `difficulty-guide` | 작업 난이도 판단 가이드 |

role skill에서 `shared_protocols` 필드로 참조하는 것과 동일한 구조.

## 아키텍처

```
Dashboard UI (/agents)
  갤러리 뷰 / 카드 그리드
  생성/편집 모달 (SKILL.md 폼 구조)
  AI 생성 패널 (자연어 → 구조화 필드)
         │
         └──── REST API ────────────────┐
                                        │
                          AgentDefinitionStore (SQLite)
                            agent_definitions 테이블
                                        │
                          빌트인 시드 (role skills → DB)
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/agent-definitions` | 전체 목록 (builtin + custom) |
| POST | `/api/agent-definitions` | 새 정의 생성 |
| PUT | `/api/agent-definitions/:id` | 수정 (custom only) |
| DELETE | `/api/agent-definitions/:id` | 삭제 (custom only) |
| POST | `/api/agent-definitions/generate` | 자연어 → 구조화 정의 AI 생성 (SSE) |
| POST | `/api/agent-definitions/:id/fork` | 빌트인 복제 → 커스텀 생성 |

## UI 설계

### 갤러리 페이지 (`/agents`)

```
┌─────────────────────────────────────────────────────┐
│  [🔍 에이전트 검색...]        [+ 새 에이전트]         │
│  [전체] [concierge] [pm] [implementer] [reviewer]... │
├─────────────────────────────────────────────────────┤
│  Built-in Agents                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ 🎩 Concierge │  │ 📋 PM        │  │ 🔧 Impl.  │ │
│  │ 사용자 대면  │  │ 기획 전담    │  │ 구현 전문 │ │
│  │ [role:concierge] │  │ [role:pm]    │  │ [role:impl] │ │
│  │ [복사]       │  │ [복사]       │  │ [복사]    │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
├─────────────────────────────────────────────────────┤
│  My Agents                                          │
│  ┌──────────────┐                                   │
│  │ 🔍 PR Review │                                   │
│  │ GitHub PR 전문│                                  │
│  │ [role:reviewer] │                                │
│  │ [편집] [삭제] │                                  │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

### 에이전트 생성/편집 모달

SKILL.md frontmatter 구조를 그대로 폼으로 노출:

```
┌─ 에이전트 설정 ──────────────────────────────────────┐
│  [AI로 생성] 탭   │   [직접 작성] 탭                  │
│                                                      │
│  ① 기본 정보                                         │
│     아이콘 [🤖]   이름 [________________]            │
│     설명 (Use when...) [__________________]          │
│                                                      │
│  ② 역할 (Role Skill)                                 │
│     [role:pm ▼]  → soul/heart 자동 채워짐             │
│     soul: [재정의 가능한 텍스트]                      │
│     heart: [재정의 가능한 텍스트]                     │
│                                                      │
│  ③ 공통 규칙 (Shared Protocols)                      │
│     [✓] clarification-protocol                      │
│     [✓] phase-gates                                 │
│     [ ] error-escalation                            │
│     [ ] session-metrics / difficulty-guide          │
│                                                      │
│  ④ 허용 도구 (Tools)                                 │
│     role 기본값에서 추가/제거                        │
│     [read_file ✓] [write_file ✓] [exec ✓] ...       │
│                                                      │
│  ⑤ 추가 스킬 (Skills)                               │
│     [+ 스킬 추가]  github / cron / memory ...        │
│                                                      │
│  ⑥ 경계 (Boundary)                                  │
│     Use when: [__________________________________]   │
│     Do NOT use for: [____________________________]   │
│                                                      │
│  ⑦ 추가 지침 (Extra Instructions)                   │
│     [선택사항 텍스트 에디터]                         │
│                                                      │
│                          [취소]  [저장]              │
└──────────────────────────────────────────────────────┘
```

### AI 생성 흐름

```
사용자 입력: "GitHub PR 리뷰를 자동화하는 에이전트"
                    │
                    ▼
POST /api/agent-definitions/generate (SSE)
  LLM 컨텍스트:
    - 사용 가능한 role skills 목록
    - 사용 가능한 tools 목록
    - _shared/ 프로토콜 목록
    - AgentDefinition 필드 스키마
                    │
                    ▼
  SSE 스트리밍으로 각 필드 순차 생성:
    role_skill: "role:reviewer"
    soul: "코드 품질의 수호자..."
    heart: "구체적 코드 라인을 인용..."
    tools: ["read_file", "exec", "web_fetch"]
    shared_protocols: ["clarification-protocol", ...]
    use_when: "PR 코드 리뷰, 품질 검사..."
    not_use_for: "코드 직접 수정..."
                    │
                    ▼
  UI: 각 필드가 실시간으로 채워지는 모습 표시
  사용자: 검토 후 수정하거나 그대로 [저장]
```

## 파일 구조

### 백엔드

```
src/agent/
  agent-definition.types.ts      # AgentDefinition 타입
  agent-definition.store.ts      # SQLite CRUD
  agent-definition-builtin.ts    # role skills → DB 시드 데이터

src/dashboard/ops/
  agent-definition.ts            # REST API 핸들러
```

### 프론트엔드

```
web/src/pages/agents/
  index.tsx                      # 갤러리 메인
  agent-card.tsx                 # 개별 카드 컴포넌트
  agent-modal.tsx                # 생성/편집 모달
```

## 빌트인 vs 커스텀 정책

| 항목 | 빌트인 | 커스텀 |
|------|--------|--------|
| 출처 | `src/skills/roles/*/SKILL.md` 시드 | 사용자 생성 |
| 수정 | 불가 | 가능 |
| 삭제 | 불가 | 가능 |
| 복사 | 가능 → 커스텀 생성 | 가능 |
| `is_builtin` | `true` | `false` |

## 구현 참조

- `src/agent/provider-store.ts` — SQLite 스토어 패턴 참조
- `src/dashboard/ops/agent-provider.ts` — API 핸들러 패턴 참조
- `src/skills/roles/pm/SKILL.md` — 빌트인 에이전트 데이터 소스
- `src/skills/_shared/*.md` — 공통 규칙 프로토콜 소스
