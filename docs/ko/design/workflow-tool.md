# 설계: WorkflowTool — 자연어 → 워크플로우 CRUD + 실행 에이전트 도구

> **상태**: 구현 완료

## 개요

에이전트가 대화 중에 워크플로우를 생성/조회/실행/삭제할 수 있는 단일 CRUD 도구.
자연어에서 DAG 추론은 에이전트(LLM)가 담당하고, WorkflowTool은 구조화된 definition을 저장/실행.

## 문제

27개 오케스트레이션 노드 + 그래프 에디터가 완성되었지만, 에이전트가 프로그래밍적으로 워크플로우를 CRUD할 수단이 없었음. 사용자가 "매일 아침 RSS 크롤링해서 요약해줘"라고 하면 에이전트는 대시보드 UI를 안내하는 수밖에 없었음.

## 아키텍처

### 단일 도구 + action 파라미터 패턴

`CronTool`, `DecisionTool`과 동일한 패턴:

```
WorkflowTool
├── action: create | list | get | run | update | delete | export
├── name: 워크플로우 이름/slug
├── definition: WorkflowDefinition (create/update용)
└── variables: 런타임 변수 오버라이드 (run용)
```

### Action 흐름

| Action | 입력 | 동작 | 출력 |
|--------|------|------|------|
| `create` | name + definition | YAML 저장 + 크론 자동 등록 | `{ ok, slug }` |
| `list` | - | 템플릿 목록 | `[{ title, slug, phases, orche_nodes, trigger }]` |
| `get` | name | 단건 조회 | WorkflowDefinition JSON |
| `run` | name 또는 definition | 즉시 실행 (비동기) | `{ ok, workflow_id }` |
| `update` | name + definition | 기존 덮어쓰기 + 크론 재등록 | `{ ok, slug }` |
| `delete` | name | 파일 삭제 + 크론 해제 | `{ ok, name }` |
| `export` | name | YAML 문자열 반환 | raw YAML |

### 의존성 주입

```typescript
// DashboardWorkflowOps 인터페이스 (dashboard/service.ts)
// ops-factory.ts에서 구현, main.ts에서 WorkflowTool에 주입
constructor(ops: DashboardWorkflowOps)
```

### 노드 카탈로그 자동 주입

`build_node_catalog()`가 NodeHandler registry를 순회하여 27개 노드의 입출력 스키마를 텍스트로 생성. 이를 도구 description에 포함하여 에이전트가 사용 가능한 노드 타입을 인지.

```
## Available Workflow Node Types (27)
- http [🌐]: (url: string, method: string, ...) → (status: number, body: string, ...)
- code [💻]: (language: string, code: string) → (result: string, stdout: string, ...)
...
```

## 실행 흐름

```
사용자: "매일 아침 9시에 RSS 크롤링해서 요약해줘"
    ↓
에이전트 (LLM): 자연어 → DAG 추론
    ↓
에이전트 → workflow tool: { action: "create", name: "daily-rss", definition: { ... } }
    ↓
WorkflowTool.handle_create() → ops.save_template() → YAML 저장 + 크론 등록
    ↓
에이전트: "daily-rss 워크플로우를 생성하고 매일 9시 크론을 등록했습니다."
```

## 파일 구조

```
src/agent/tools/
  workflow.ts            # WorkflowTool 클래스 (7 action 핸들러)
  workflow-catalog.ts    # 노드 카탈로그 텍스트 생성
  index.ts               # export + 등록

src/dashboard/
  service.ts             # DashboardWorkflowOps 인터페이스
  ops-factory.ts         # create_workflow_ops() 구현

src/main.ts              # WorkflowTool 등록 (ops 주입)
```

## 관련 문서

→ [Node Registry](./node-registry.md) — 27개 노드 카탈로그 소스
→ [Phase Loop](./phase-loop.md) — 워크플로우 실행 엔진
