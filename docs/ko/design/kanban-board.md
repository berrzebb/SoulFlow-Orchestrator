# 설계: 칸반 보드 — 에이전트 + 사람의 태스크 관리 시스템

> **상태**: Phase 1 완료 (핵심 CRUD), Phase 2 완료 (활동 로그, WIP 제한, 자동화 규칙, 템플릿, 메트릭스), Phase 3 진행 중 (기한 관리, 시간 추적, 검색, 저장된 필터, SSE)

## 개요

**에이전트가 작업을 분해하고, 진행 상황을 추적하며, 이슈 카드를 통해 협업**하는 칸반 보드 시스템. 사람(대시보드)과 에이전트(`kanban` 도구) 모두 카드를 생성/이동/수정 가능. 보드는 워크플로우(프로젝트)/채널/세션별로 독립 관리.

`TaskState`(에이전트 루프 실행 상태)와는 별도 엔티티. KanbanCard는 자유롭게 조작하는 작업 항목.

## 문제

멀티에이전트 오케스트레이션에 태스크 분해, 진행 추적, 에이전트 간 피드백을 위한 공유 작업 공간이 없음:
- 에이전트가 세션 간 작업 분해 결과를 보존할 수 없음
- QA 에이전트가 구현 에이전트에게 구조화된 피드백을 남길 방법 없음
- 사람이 에이전트의 작업 진행 상황을 확인할 수 없음
- 중단된 작업 재개 시 에이전트가 이전 진행 상황 컨텍스트를 잃음

## 아키텍처

```
Dashboard (UI)                    Agent (kanban tool)
  보드 뷰 / 리스트 뷰               kanban("create_card", ...)
  카드 상세 사이드 패널              kanban("move_card", ...)
         │                                │
         └────────── REST API ────────────┘
                       │
              KanbanStore (SQLite)
           kanban_boards │ kanban_cards
           kanban_comments │ kanban_relations
```

### 워크플로우 → 보드 자동 생성

워크플로우가 프로젝트를 시작하면 에이전트가 **스스로** `kanban("create_board", ...)`를 호출하여 보드를 생성하고, 이슈를 등록하며, 작업을 진행. 수동 보드 생성 불필요.

## 데이터 모델

### Board

```typescript
interface KanbanBoard {
  board_id: string;           // nanoid
  name: string;
  prefix: string;             // 카드 ID 접두사 (예: "KB", "SP")
  next_seq: number;           // 다음 카드 순번 (1-based)
  scope_type: "channel" | "session" | "workflow";
  scope_id: string;
  columns: KanbanColumnDef[];
  created_at: string;
  updated_at: string;
}

interface KanbanColumnDef {
  id: string;      // slug: "todo", "in_progress", "in_review", "done"
  name: string;
  color: string;   // hex
  wip_limit?: number;
}
```

**기본 컬럼 프리셋:**

| ID | 이름 | 색상 | 의미 |
|----|------|------|------|
| `todo` | TODO | `#95a5a6` | 등록됨, 미착수 |
| `in_progress` | In Progress | `#3498db` | 진행 중 |
| `in_review` | In Review | `#f39c12` | 검토/승인 대기 |
| `done` | Done | `#27ae60` | 완료 |

### 카드 ID 체계

보드마다 `next_seq` 카운터. **사람이 읽을 수 있는 순차 ID** 발급:

```
{board_prefix}-{seq}   예: KB-1, KB-2, ISS-42
```

### Card (WorkItem)

```typescript
interface KanbanCard {
  card_id: string;           // 예: "ISS-3"
  board_id: string;
  title: string;
  description: string;       // 마크다운
  column_id: string;
  position: number;          // 컬럼 내 순서 (0-based)
  priority: "urgent" | "high" | "medium" | "low" | "none";
  labels: string[];          // 컬러 태그: "ui:#3498db", "bug:#e74c3c"
  assignee?: string;         // agent_id 또는 "user"
  created_by: string;        // agent_id 또는 "user:dashboard"
  task_id?: string;          // TaskState 연결 (선택)
  metadata: Record<string, unknown>; // {files, commit, branch, pr_url, lines_added, ...}
  comment_count: number;
  created_at: string;
  updated_at: string;
}
```

### Relations (카드 간 관계)

```typescript
interface KanbanRelation {
  relation_id: string;
  source_card_id: string;
  target_card_id: string;
  type: "blocked_by" | "blocks" | "related_to" | "parent_of" | "child_of";
}
```

### Comments (에이전트 간 피드백)

```typescript
interface KanbanComment {
  comment_id: string;
  card_id: string;
  author: string;     // agent_id 또는 "user:dashboard"
  text: string;
  created_at: string;
}
```

### DB 스키마

```sql
CREATE TABLE kanban_boards (
  board_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  next_seq    INTEGER NOT NULL DEFAULT 1,
  scope_type  TEXT NOT NULL CHECK(scope_type IN ('channel','session','workflow')),
  scope_id    TEXT NOT NULL,
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE kanban_cards (
  card_id       TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL,
  board_id      TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  column_id     TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  priority      TEXT NOT NULL DEFAULT 'none',
  labels_json   TEXT NOT NULL DEFAULT '[]',
  assignee      TEXT,
  created_by    TEXT NOT NULL,
  task_id       TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kanban_comments (
  comment_id  TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kanban_relations (
  relation_id      TEXT PRIMARY KEY,
  source_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  target_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  UNIQUE(source_card_id, target_card_id, type)
);
```

DB 위치: `{workspace}/runtime/kanban.db`

## 에이전트 도구: `kanban`

단일 도구, `action` 파라미터로 분기 (`memory`, `cron`, `workflow` 도구와 동일 패턴):

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `create_board` | `name, scope_type, scope_id, columns?` | 보드 생성 (기본 4컬럼) |
| `list_boards` | `scope_type?, scope_id?` | 보드 목록 |
| `create_card` | `board_id, title, description?, column_id?, priority?, labels?, assignee?, parent_id?` | 카드 생성. `parent_id` 지정 시 서브태스크 관계 자동 생성 |
| `move_card` | `card_id, column_id, position?` | 카드 컬럼 이동 |
| `update_card` | `card_id, title?, description?, priority?, labels?, assignee?, metadata?` | 카드 필드 수정 |
| `add_relation` | `source_card_id, target_card_id, type` | 카드 간 관계 추가 |
| `remove_relation` | `relation_id` | 관계 삭제 |
| `list_cards` | `board_id, column_id?, limit?` | 카드 목록 |
| `comment` | `card_id, text` | 코멘트 추가 (에이전트 간 피드백) |
| `list_comments` | `card_id, limit?` | 카드 코멘트 목록 |
| `get_card` | `card_id` | 카드 상세 (description, metadata, comments 포함) |
| `board_summary` | `board_id` | 보드 요약 (컬럼별 카드 수, 진행률, 블로커) |
| `archive_card` | `card_id` | 카드 삭제 |

### 서브태스크

`parent_of`/`child_of` 관계를 활용한 서브태스크:

```
kanban("create_card", {board_id: "abc", title: "DB migration 작성", parent_id: "ISS-3"})
```

- 부모 카드에 **Subtasks** 섹션: 체크리스트 + 프로그레스 바
- 보드 뷰에서 부모 카드에 `[2/5]` 배지
- 리스트 뷰에서 `>` 토글로 서브태스크 펼침 (들여쓰기)

### Worktree 연동

카드(이슈)별 격리된 git worktree 생성:

```
에이전트: ISS-3 작업 시작 → in_progress 이동
→ git worktree add /workspace/.worktrees/ISS-3 -b issue/ISS-3
→ 격리된 worktree에서 작업 수행
→ update_card: metadata에 {branch, worktree, files, lines_added, lines_removed} 기록
```

### PR 기반 코드 리뷰 흐름

```
구현 에이전트: push + PR 생성 → update_card metadata (pr_url, files, stats)
             → in_review 이동, QA 에이전트 할당
QA 에이전트:  PR metadata 읽기 → 코드 리뷰 → 코멘트로 피드백
             → 문제 있으면 in_progress로 되돌림
구현 에이전트: 수정 → push → in_review 재이동
QA 에이전트:  승인 → merge → done 이동
```

### 관여자(Participants)

`created_by` + `assignee` + 코멘트 `author`에서 자동 추출. 카드 하단에 아바타 아이콘 표시 (최대 3개 + "+N").

## 활동 로그 (Activity Log)

모든 카드 변경을 자동 기록하는 감사 추적(audit trail). 모든 mutation(생성, 이동, 수정, 삭제, 코멘트, 관계)이 활동 레코드를 생성.

### 데이터 모델

```typescript
type ActivityAction = "created" | "moved" | "updated" | "archived" | "commented"
  | "relation_added" | "relation_removed" | "assigned" | "priority_changed" | "labels_changed";

interface KanbanActivity {
  activity_id: string;
  card_id: string;
  board_id: string;
  actor: string;          // agent_id 또는 "user:dashboard"
  action: ActivityAction;
  detail: Record<string, unknown>;  // {from: "todo", to: "in_progress"} 등
  created_at: string;
}
```

### DB 스키마

```sql
CREATE TABLE kanban_activities (
  activity_id TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  board_id    TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activities_card ON kanban_activities(card_id, created_at);
CREATE INDEX idx_activities_board ON kanban_activities(board_id, created_at);
```

### 에이전트 도구 액션

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `list_activities` | `card_id?, board_id?, limit?` | 활동 로그 조회 |

활동은 스토어의 모든 mutation에서 자동 기록 — 에이전트가 별도로 로그를 호출할 필요 없음.

### UI: Activity 탭

CardDetailPanel에 탭 바 추가: `[Comments | Activity]`

- **Activity 탭**: 모든 변경 사항의 시간순 목록
- 각 항목: `"agent-impl이 ISS-3를 todo에서 in_progress로 이동" — 2분 전`
- 액션별 색상 뱃지 (초록=생성, 파랑=이동, 주황=수정, 빨강=삭제)

## WIP 제한

컬럼 WIP(Work-In-Progress) 제한 시행. `KanbanColumnDef`의 `wip_limit` 필드로 제어.

### 동작

- **move_card**: 대상 컬럼이 WIP 제한에 도달/초과 시 경고 메시지 반환, 이동은 허용 (소프트 제한)
- **에이전트 도구 응답**: `"ISS-5 moved to in_progress (WARNING: column WIP limit 3 exceeded, now 4 cards)"`
- **UI**: 컬럼 헤더에 `3/3` 빨간색 카운트, 초과 시 빨간 배경

### 스키마 변경 없음 — 기존 `columns_json`의 `wip_limit` 필드 활용.

## 보드 자동화 규칙

보드 수준의 트리거-액션 규칙. 에이전트 또는 사람이 설정.

### 데이터 모델

```typescript
interface KanbanRule {
  rule_id: string;
  board_id: string;
  trigger: "card_moved" | "subtasks_done" | "card_stale";
  condition: Record<string, unknown>;   // {to_column: "in_review"}
  action_type: "move_card" | "assign" | "add_label" | "comment";
  action_params: Record<string, unknown>; // {assignee: "qa-agent"}
  enabled: boolean;
  created_at: string;
}
```

### DB 스키마

```sql
CREATE TABLE kanban_rules (
  rule_id       TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL CHECK(trigger IN ('card_moved','subtasks_done','card_stale')),
  condition_json TEXT NOT NULL DEFAULT '{}',
  action_type   TEXT NOT NULL CHECK(action_type IN ('move_card','assign','add_label','comment')),
  action_params_json TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rules_board ON kanban_rules(board_id);
```

### 트리거

| 트리거 | 조건 | 예시 |
|--------|------|------|
| `card_moved` | `{to_column: "in_review"}` | 카드가 "in_review"에 도착할 때 |
| `subtasks_done` | `{}` | 부모 카드의 모든 서브태스크가 완료될 때 |
| `card_stale` | `{column: "in_progress", hours: 24}` | 카드가 컬럼에 N시간 이상 머물 때 |

### 액션

| 액션 | 파라미터 | 예시 |
|------|----------|------|
| `move_card` | `{column_id: "in_review"}` | 서브태스크 완료 시 부모 자동 이동 |
| `assign` | `{assignee: "qa-agent"}` | 리뷰어 자동 할당 |
| `add_label` | `{label: "stale:#e74c3c"}` | 정체 카드 표시 |
| `comment` | `{text: "모든 서브태스크 완료"}` | 자동 코멘트 |

### 에이전트 도구 액션

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `add_rule` | `board_id, trigger, condition, action_type, action_params` | 자동화 규칙 생성 |
| `list_rules` | `board_id` | 보드 규칙 목록 |
| `remove_rule` | `rule_id` | 규칙 삭제 |
| `toggle_rule` | `rule_id, enabled` | 규칙 활성화/비활성화 |

### 실행

- `card_moved` / `subtasks_done`: 트리거링 mutation 이후 동기적 평가
- `card_stale`: 크론 스케줄러로 실행 (기존 `cron.db` 인프라 활용)

### UI: 규칙 패널

보드 헤더에 톱니바퀴 아이콘 → 규칙 모달 열기:

```
자동화 규칙 (3개 활성)
┌─────────────────────────────────────────────┐
│ [ON]  카드가 "In Review"로 이동될 때        │
│       → qa-agent에 할당                     │
│                                  [편집][X]  │
├─────────────────────────────────────────────┤
│ [ON]  모든 서브태스크 완료 시               │
│       → 부모를 "In Review"로 이동           │
│                                  [편집][X]  │
├─────────────────────────────────────────────┤
│ [OFF] 카드가 "In Progress"에 24시간 이상    │
│       → "stale" 라벨 추가                   │
│                                  [편집][X]  │
└─────────────────────────────────────────────┘
[+ 규칙 추가]
```

## 보드 템플릿

반복 프로젝트를 위한 보드 + 초기 카드 프리셋.

### 데이터 모델

```typescript
interface KanbanTemplate {
  template_id: string;
  name: string;
  description: string;
  columns?: KanbanColumnDef[];  // 커스텀 컬럼 (null = 기본값)
  cards: Array<{
    title: string;
    description?: string;
    column_id?: string;
    priority?: Priority;
    labels?: string[];
  }>;
  created_at: string;
}
```

### DB 스키마

```sql
CREATE TABLE kanban_templates (
  template_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  columns_json TEXT,                        -- null = 기본 컬럼 사용
  cards_json   TEXT NOT NULL DEFAULT '[]',  -- 초기 카드 정의
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 에이전트 도구 액션

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `create_template` | `name, description?, columns?, cards` | 보드 템플릿 저장 |
| `list_templates` | — | 사용 가능한 템플릿 목록 |
| `create_board_from_template` | `template, scope_type, scope_id, name?` | 템플릿으로 보드 생성 |
| `delete_template` | `template_id` | 템플릿 삭제 |

### UI: 템플릿 선택기

보드 생성 모달에 "템플릿에서" 탭 추가:

```
[빈 보드 | 템플릿에서]

사용 가능한 템플릿:
┌─────────────────────────────────┐
│  Feature Development            │
│  설계 → 구현 → 테스트           │
│  초기 카드 4개                   │
│                       [사용]    │
├─────────────────────────────────┤
│  Bug Triage                     │
│  보고 → 재현 → 수정             │
│  초기 카드 3개                   │
│                       [사용]    │
└─────────────────────────────────┘
```

## 보드 메트릭스

프로젝트 건강 지표. 활동 로그 데이터 기반.

### 에이전트 도구 액션

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `board_metrics` | `board_id, days?` | Velocity, cycle time, throughput |

### 응답

```typescript
interface BoardMetrics {
  board_id: string;
  period_days: number;
  cards_completed: number;         // 기간 내 완료 카드 수
  avg_cycle_time_hours: number;    // 생성 → done 평균 시간
  avg_review_time_hours: number;   // in_review 평균 체류 시간
  throughput_per_day: number;      // 일일 완료 카드 수
  column_distribution: Record<string, number>;  // 현재 컬럼별 카드 수
  stale_cards: Array<{ card_id: string; title: string; column_id: string; hours_stuck: number }>;
}
```

Cycle time은 `kanban_activities`에서 계산:
- 카드별 `created` → 첫 `moved to done` 타임스탬프 차이

### UI: 메트릭스 패널

보드 헤더에 차트 아이콘 → 메트릭스 패널 열기:

```
보드 메트릭스 (최근 7일)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

완료:           12장
평균 Cycle Time: 4.2h
리뷰 시간:       1.1h
Throughput:     1.7/일

컬럼 분포:
  TODO        ████████ 8
  In Progress ███ 3
  In Review   ██ 2
  Done        ████████████ 12

정체 카드 (>24h 동일 컬럼):
  ISS-7 "Fix auth bug" — In Progress — 36h
  ISS-13 "Caching"     — TODO        — 48h
```

## 카드 기한 관리 & 초과 감지

카드에 `due_date` 필드 추가. 에이전트가 작업 분해 시 기한 설정, 초과 카드 자동 감지.

### 데이터 모델 변경

```typescript
// KanbanCard에 추가
interface KanbanCard {
  // ... 기존 필드 ...
  due_date?: string;  // ISO 날짜 (날짜만, 시간 없음)
}
```

### DB 스키마

```sql
ALTER TABLE kanban_cards ADD COLUMN due_date TEXT;
CREATE INDEX idx_cards_due ON kanban_cards(due_date) WHERE due_date IS NOT NULL;
```

### 동작

- `create_card` / `update_card`에 `due_date` 파라미터 추가
- `board_summary`에 `overdue` 배열 포함: `due_date < 오늘 AND column_id != 'done'`
- `card_stale` 자동화 트리거와 연동: condition `{overdue: true}` 매칭
- Activity log에 `due_date_set` 액션 기록

### UI

- 카드 뱃지: `📅 3월 15일` (회색), `📅 초과` (빨간색, 깜빡임)
- 상세 패널: 날짜 선택기
- 리스트 뷰: Due 컬럼 (초록=미래, 노랑=오늘, 빨강=초과)

## 카드 시간 추적

Activity Log `moved` 이벤트에서 **컬럼 체류 시간 자동 계산**. 수동 입력 불필요.

### 인터페이스

```typescript
interface ColumnDwellTime {
  column_id: string;
  entered_at: string;
  exited_at?: string;    // null = 현재 컬럼에 있음
  duration_hours: number;
}

interface CardTimeTracking {
  card_id: string;
  total_hours: number;
  column_times: ColumnDwellTime[];
}
```

### 계산 방식

`kanban_activities`에서 `action = 'moved'` 이벤트로 도출:
1. 카드의 `moved` 이벤트를 시간순 정렬
2. 각 `{from, to}` 쌍이 `from` 퇴장 + `to` 진입 정의
3. 최초 진입 = 카드 `created_at`의 초기 컬럼
4. 현재 컬럼은 퇴장 없음 (`now()` 사용)

### 에이전트 도구

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `card_time_tracking` | `card_id` | 카드의 컬럼별 체류 시간 |

### UI

카드 상세 패널 → 시간 추적 섹션:
```
시간 추적
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODO         ██ 2.1h
In Progress  ████████ 8.5h
In Review    ███ 3.2h        ← 현재
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
총: 13.8h
```

## 크로스 보드 카드 검색

모든 보드를 가로지르는 전체 카드 검색. 에이전트가 관련 작업을 찾거나 중복 이슈 탐지.

### 인터페이스

```typescript
interface SearchResult {
  card_id: string;
  board_id: string;
  board_name: string;
  title: string;
  description_snippet: string;
  column_id: string;
  priority: Priority;
  score: number;  // 관련도
}
```

### 구현

SQLite LIKE 기반 (FTS5 업그레이드 경로 존재):
- 검색 대상: `title`, `description`, `card_id`, `labels_json`
- 선택 필터: `board_id`, `column_id`, `priority`, `assignee`
- 결과 정렬: 관련도 (card_id 정확 매칭 > title > description)

### 에이전트 도구

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `search` | `query, board_id?, limit?` | 보드 횡단 카드 검색 |

### REST API

```
GET /api/kanban/search?q=auth&board_id=...&limit=20
```

## 저장된 필터

보드별 이름 있는 필터 프리셋. 자주 쓰는 뷰를 빠르게 전환.

### 데이터 모델

```typescript
interface KanbanFilter {
  filter_id: string;
  board_id: string;
  name: string;
  criteria: FilterCriteria;
  created_by: string;
  created_at: string;
}

interface FilterCriteria {
  column_ids?: string[];
  priority?: Priority[];
  assignee?: string;
  labels?: string[];
  due_before?: string;    // ISO 날짜
  overdue?: boolean;
  search?: string;
}
```

### DB 스키마

```sql
CREATE TABLE kanban_filters (
  filter_id    TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  criteria_json TEXT NOT NULL DEFAULT '{}',
  created_by   TEXT NOT NULL DEFAULT 'user:dashboard',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(board_id, name)
);
```

### 에이전트 도구

| Action | 파라미터 | 설명 |
|--------|----------|------|
| `save_filter` | `board_id, name, criteria` | 이름 있는 필터 저장 |
| `list_filters` | `board_id` | 저장된 필터 목록 |
| `delete_filter` | `filter_id` | 필터 삭제 |

### UI

FilterBar에 저장된 필터 드롭다운:
```
[Active ▾] [내 작업] [긴급 블로커] [QA 큐] [+ 현재 필터 저장]
```

## 보드 이벤트 스트림 (SSE)

Server-Sent Events를 통한 실시간 업데이트. 15초 폴링 대체.

### 엔드포인트

```
GET /api/kanban/boards/:id/events    SSE 스트림
```

### 이벤트

```typescript
type KanbanEvent =
  | { type: "card_created"; card: KanbanCard }
  | { type: "card_moved"; card_id: string; from: string; to: string }
  | { type: "card_updated"; card_id: string; changes: Record<string, unknown> }
  | { type: "card_deleted"; card_id: string }
  | { type: "comment_added"; card_id: string; comment: KanbanComment }
```

### 구현

- `KanbanStore.log_activity()` 호출 시 보드별 `EventEmitter`에 발행
- SSE 핸들러가 연결 시 구독, 종료 시 해제
- 30초마다 하트비트 전송
- 프론트엔드: `EventSource` → 메시지 수신 → `queryClient.invalidateQueries(["kanban", boardId])`
- Fallback: SSE 연결 실패 시 15초 폴링으로 자동 전환

### UI

- 보드 헤더에 연결 표시기: `●` (초록=연결됨, 회색=폴링)

## REST API

> 활동 로그, 규칙, 템플릿, 메트릭스, 검색, 필터, SSE 엔드포인트 추가.

```
GET    /api/kanban/boards                     보드 목록 (scope 쿼리 필터)
POST   /api/kanban/boards                     보드 생성
GET    /api/kanban/boards/:id                 보드 상세 (컬럼 + 전체 카드)
PUT    /api/kanban/boards/:id                 보드 수정 (이름, 컬럼)
DELETE /api/kanban/boards/:id                 보드 삭제

POST   /api/kanban/boards/:id/cards           카드 생성
PUT    /api/kanban/cards/:id                  카드 수정/이동
DELETE /api/kanban/cards/:id                  카드 삭제

GET    /api/kanban/cards/:id/comments         코멘트 목록
POST   /api/kanban/cards/:id/comments         코멘트 추가

POST   /api/kanban/cards/:id/relations        관계 추가
DELETE /api/kanban/relations/:id              관계 삭제

GET    /api/kanban/cards/:id/activities       카드 활동 로그
GET    /api/kanban/boards/:id/activities      보드 활동 로그

GET    /api/kanban/boards/:id/rules           자동화 규칙 목록
POST   /api/kanban/boards/:id/rules           규칙 생성
PUT    /api/kanban/rules/:id                  규칙 수정 (토글, 편집)
DELETE /api/kanban/rules/:id                  규칙 삭제

GET    /api/kanban/templates                  템플릿 목록
POST   /api/kanban/templates                  템플릿 생성
DELETE /api/kanban/templates/:id              템플릿 삭제
POST   /api/kanban/templates/:id/apply        템플릿으로 보드 생성

GET    /api/kanban/boards/:id/metrics         보드 메트릭스 (query: days)

GET    /api/kanban/search                     크로스 보드 카드 검색 (query: q, board_id?, limit?)

GET    /api/kanban/boards/:id/filters         저장된 필터 목록
POST   /api/kanban/boards/:id/filters         필터 저장
DELETE /api/kanban/filters/:id                필터 삭제

GET    /api/kanban/boards/:id/events          SSE 이벤트 스트림

GET    /api/kanban/cards/:id/time-tracking    카드 컬럼 체류 시간
```

## 프론트엔드

### 뷰 전환

`[Board | List]` 토글로 두 가지 뷰 전환, 같은 데이터:

- **보드 뷰** (기본): 칸반 컬럼 레이아웃
- **리스트 뷰**: 정렬 가능한 테이블 (priority, status, updated_at), Linear 스타일

두 뷰 모두 `CardDetailPanel` (슬라이드인 사이드 패널) 공유.

### 컴포넌트 구조

```
KanbanPage
├── BoardHeader
│   ├── BoardSelector (드롭다운, 보드 전환)
│   ├── ViewToggle [Board | List]
│   ├── FilterBar (Active/All/Backlog/Done + 저장된 필터 + 검색)
│   ├── NewIssueButton (빈 보드 또는 템플릿에서)
│   ├── RulesButton (톱니바퀴 → RulesModal)
│   ├── MetricsButton (차트 아이콘 → MetricsPanel)
│   └── SSEIndicator (● 초록=연결됨, 회색=폴링)
├── KanbanBoard / IssueListView (뷰 모드에 따라 전환)
│   ├── KanbanColumn × N (WIP 카운트 + 제한 뱃지)
│   │   └── KanbanCard × N (서브태스크 뱃지, 참여자)
│   └── IssueRow × N (리스트 뷰, 서브태스크 펼침)
├── CardDetailPanel (슬라이드인)
│   ├── 헤더 (card_id, status, priority, assignee, due_date — 모두 편집 가능)
│   ├── 제목 (인라인 편집)
│   ├── 라벨 (추가/삭제)
│   ├── 설명 (textarea)
│   ├── 서브태스크 (체크리스트 + 프로그레스 바)
│   ├── 시간 추적 (컬럼 체류 바 차트)
│   ├── Workspaces (branch, files, PR 링크, git stats)
│   ├── Relationships (blocked_by, related_to)
│   ├── 탭 바 [Comments | Activity]
│   │   ├── Comments (스레드 + 입력창)
│   │   └── Activity (자동 생성 변경 이력)
│   └── 삭제 버튼
├── RulesModal (보드 자동화 규칙 CRUD)
├── MetricsPanel (velocity, cycle time, 정체 카드)
└── CreateBoardModal (빈 보드 또는 템플릿 선택기)
```

### 모바일

- 보드: CSS snap 가로 스크롤 (85vw/컬럼)
- 상세 패널: 풀스크린 오버레이
- 터치 타겟: 최소 36px

## 파일 구조

### 신규 파일

| 파일 | 설명 |
|------|------|
| `src/services/kanban-store.ts` | SQLite 스토어 (CRUD) |
| `src/agent/tools/kanban.ts` | 에이전트 도구 (28개 액션) |
| `src/dashboard/routes/kanban.ts` | REST API 핸들러 |
| `web/src/pages/kanban.tsx` | 칸반 페이지 (보드 + 리스트 + 상세) |
| `web/src/styles/kanban.css` | 칸반 스타일 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `web/src/router.tsx` | `/kanban`, `/kanban/:boardId` 라우트 |
| `web/src/layouts/sidebar.tsx` | nav item (Main 그룹) |
| `src/agent/tools/index.ts` | KanbanTool 등록 |
| `src/dashboard/service.ts` | 칸반 라우트 등록 |
| `src/main.ts` | KanbanStore 초기화 + 도구 주입 |
| `src/i18n/locales/{en,ko}.json` | `kanban.*` 키 (~30개) |

## 관련 문서

-> [Phase Loop](./phase-loop.md) — 워크플로우 실행 엔진 (보드 scope: workflow)
-> [PTY Agent Backend](./pty-agent-backend.md) — Worktree 격리 패턴
-> [Loop Continuity & HITL](./loop-continuity-hitl.md) — TaskState (칸반 카드와 별도)
