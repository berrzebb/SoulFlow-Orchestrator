# 설계: Node Registry — OCP 기반 노드 아키텍처

> **상태**: 구현 완료 · 27개 노드 타입 등록 + 컨테이너 샌드박스 코드 실행

## 개요

노드 추가 시 **8개 파일 18+ 위치**를 수정해야 했던 OCP 위반을 해소. 이제 **descriptor 파일 1개 + barrel 등록 1줄**로 노드 추가 완료.

## 문제

기존에 새 노드 타입 추가 시 수동 수정이 필요했던 위치:

| 위치 | 파일 | 유형 |
|------|------|------|
| `ORCHE_COLORS` | graph-editor.tsx | Record |
| `ORCHE_ICONS` | graph-editor.tsx | Record |
| `ORCHE_TYPES` | graph-editor.tsx | Set |
| `AuxNode` switch | graph-editor.tsx | 12-case switch |
| `addOrcheNode` defaults | graph-editor.tsx | Record |
| 툴바 버튼 | graph-editor.tsx | 12 × JSX |
| `OrcheNodeEditModal` | builder.tsx | 12 × if-block |
| `execute_orche_node` | orche-node-executor.ts | 12-case switch |
| `test_orche_node` | orche-node-executor.ts | 12-case switch |
| `NODE_OUTPUT_SCHEMAS` | workflow-node.types.ts | Record |
| 타입 union (×3) | graph-editor / phase-loop.types | 리터럴 union |

## 아키텍처

### 핵심: Descriptor + Handler 패턴

```
┌──────────────────────────────────────────────────┐
│  Backend: NodeHandler                             │
│  node_type, icon, color, shape,                   │
│  output_schema, input_schema, create_default(),   │
│  execute(), test()                                │
├──────────────────────────────────────────────────┤
│  Frontend: FrontendNodeDescriptor                 │
│  node_type, icon, color, shape,                   │
│  toolbar_label, output_schema, input_schema,      │
│  create_default(), EditPanel 컴포넌트              │
└──────────────────────────────────────────────────┘
```

### 백엔드 (`src/agent/`)

```typescript
// node-registry.ts
interface NodeHandler {
  node_type: string;
  icon: string;
  color: string;
  shape: "rect" | "diamond";
  output_schema: OutputField[];
  input_schema: OutputField[];
  create_default: () => Record<string, unknown>;
  execute: (node, ctx) => Promise<OrcheNodeExecuteResult>;
  test: (node, ctx) => OrcheNodeTestResult;
}
```

### 프론트엔드 (`web/src/pages/workflows/`)

```typescript
// node-registry.ts
interface FrontendNodeDescriptor {
  node_type: string;
  icon: string;
  color: string;
  shape: "rect" | "diamond";
  toolbar_label: string;
  output_schema: OutputField[];
  input_schema: OutputField[];
  create_default: () => Record<string, unknown>;
  EditPanel: React.ComponentType<EditPanelProps>;
}
```

## 데이터 드리븐 패턴

### 툴바 — registry에서 자동 생성

```tsx
{get_all_frontend_nodes().map((d) => (
  <button key={d.node_type} style={{ color: d.color }}>
    {d.toolbar_label}
  </button>
))}
```

### AuxNode — shape 기반 디스패치

```tsx
const desc = get_frontend_node(node.type);
if (desc?.shape === "rect") return <OrcheRectNode .../>;
// diamond: 전용 컴포넌트 (IF/Merge/Split/Switch)
```

### 편집 모달 — 단일 위임

```tsx
const desc = get_frontend_node(node.node_type);
{desc?.EditPanel && <desc.EditPanel node={node} update={update} t={t} />}
```

### Executor — registry 조회

```typescript
const handler = get_node_handler(node.node_type);
return handler.execute(node, ctx);
```

## 파일 구조

```
src/agent/
  node-registry.ts           # NodeHandler + registry API
  nodes/
    index.ts                  # barrel 등록 (멱등)
    http.ts  code.ts  if.ts  merge.ts  set.ts  split.ts
    llm.ts  switch.ts  wait.ts  template.ts  oauth.ts  sub-workflow.ts
    filter.ts  loop.ts  transform.ts  db.ts  file.ts
    analyzer.ts  retriever.ts  ai-agent.ts  text-splitter.ts
    task.ts  spawn-agent.ts  decision.ts  promise.ts
    embedding.ts  vector-store.ts
    container-code-runner.ts   # 컨테이너 샌드박스 실행기 (python, ruby, go, ...)

web/src/pages/workflows/
  node-registry.ts            # FrontendNodeDescriptor + registry API
  nodes/
    index.ts                  # barrel 등록 (멱등)
    http.tsx  code.tsx  if.tsx  merge.tsx  set.tsx  split.tsx
    llm.tsx  switch.tsx  wait.tsx  template.tsx  oauth.tsx  sub-workflow.tsx
    filter.tsx  loop.tsx  transform.tsx  db.tsx  file.tsx
    analyzer.tsx  retriever.tsx  ai-agent.tsx  text-splitter.tsx
    task.tsx  spawn-agent.tsx  decision.tsx  promise.tsx
    embedding.tsx  vector-store.tsx
```

## 타입 안전성

`OrcheNodeType` union은 2곳에 정규 정의:
- 백엔드: `src/agent/workflow-node.types.ts`
- 프론트엔드: `web/src/pages/workflows/graph-editor.tsx`

다른 파일들은 이 소스에서 import. 새 노드 추가 시 이 2곳 + descriptor 2개 파일만 수정.

## 새 노드 추가 체크리스트

1. `src/agent/nodes/my-node.ts` — `NodeHandler` 구현
2. `src/agent/nodes/index.ts` barrel에 추가
3. `web/src/pages/workflows/nodes/my-node.tsx` — `FrontendNodeDescriptor` + `EditPanel` 구현
4. `web/src/pages/workflows/nodes/index.ts` barrel에 추가
5. `OrcheNodeType`에 `"my_node"` 추가 (`workflow-node.types.ts` + `graph-editor.tsx`)

## 영향 파일

| 파일 | 변경 |
|------|------|
| `src/agent/node-registry.ts` | **신규** |
| `src/agent/nodes/*.ts` (12개) | **신규** |
| `src/agent/nodes/index.ts` | **신규** |
| `src/agent/orche-node-executor.ts` | switch → registry 조회 |
| `src/agent/workflow-node.types.ts` | `NODE_OUTPUT_SCHEMAS` 삭제 |
| `web/src/pages/workflows/node-registry.ts` | **신규** |
| `web/src/pages/workflows/nodes/*.tsx` (12개) | **신규** |
| `web/src/pages/workflows/nodes/index.ts` | **신규** |
| `web/src/pages/workflows/output-schema.ts` | Proxy 기반 registry 조회 |
| `web/src/pages/workflows/graph-editor.tsx` | ORCHE_* 상수 삭제, 데이터 드리븐 |
| `web/src/pages/workflows/builder.tsx` | 12개 if-block → `desc.EditPanel` |
| `src/agent/phase-loop.types.ts` | `OrcheNodeType` import |
