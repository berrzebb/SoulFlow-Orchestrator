# 워크플로우 빌더: Command Palette (NodePalette)

**Status**: ✅ Implemented

## 개요

워크플로우 빌더 상단 toolbar에 **[+ Tool / Skill]** 버튼을 추가하여, 클릭 시 검색 가능한 **Command Palette 팝오버**를 열 수 있도록 구현했습니다.

### 목표
- 한 번의 클릭으로 도구/스킬 선택 + 노드 추가 (2단계 → 1단계 단순화)
- 도구/스킬 검색 (이름 + 설명 fuzzy matching)
- MCP 서버별 그룹핑 + 연결 상태 표시
- 키보드 네비게이션 (↑↓ 탐색, Enter 선택, Esc 닫기)
- 모바일 반응형 UI

## 아키텍처

### 컴포넌트 구조

```
WorkflowBuilderPage
├── toolbar: [+ Tool / Skill] 버튼
├── NodePalette (paletteOpen && toolsData)
│   ├── 검색 입력
│   ├── 그룹 목록
│   │   ├── Built-in (native tools)
│   │   ├── Registered (기타 도구)
│   │   ├── MCP: {서버명} (서버별 도구 + 연결 상태)
│   │   └── Skills
│   └── 아이템 렌더링 (hoverable, keyboard navigable)
└── onSelectTool / onSelectSkill 콜백
    ├── tool_nodes / skill_nodes 배열에 추가
    ├── 첫 번째 phase에 attach_to 설정
    └── 인스펙터에서 자동 선택
```

### 데이터 흐름

1. **조회**: `/api/tools` → `toolsData` (names, definitions, mcp_servers)
2. **조회**: `/api/skills` → `skillsData` (SkillListItem[])
3. **필터링**: query로 이름/설명 기반 검색
4. **그룹화**: build_items()에서 native/registered/mcp별로 분류
5. **렌더링**: PaletteItem[] → UI 렌더링
6. **선택**: onSelectTool/onSelectSkill → tool_nodes/skill_nodes 추가

## 타입 설계

### McpServer (node-palette.tsx)
```typescript
interface McpServer {
  name: string;
  connected?: boolean;  // 선택적 (API 응답이 connected 필드 없을 수 있음)
  tools: string[];
  error?: string;
}
```

### ToolsData (node-palette.tsx)
```typescript
export interface ToolsData {
  names: string[];                        // 모든 도구 이름 (중복 없음)
  definitions: Array<Record<string, unknown>>;  // OpenAPI 정의 배열
  mcp_servers: McpServer[];              // MCP 서버 목록
  native_tools?: string[];               // Built-in 도구 이름
}
```

### PaletteItem (내부)
```typescript
interface PaletteItem {
  kind: "tool" | "skill";
  id: string;
  description: string;
  group: string;
}
```

### NodePaletteProps
```typescript
interface NodePaletteProps {
  tools: ToolsData;
  skills: SkillItem[];
  onSelectTool: (tool_id: string, description: string) => void;
  onSelectSkill: (skill_name: string, description: string) => void;
  onClose: () => void;
}
```

## 영향받는 파일

| 파일 | 변경 |
|------|------|
| `web/src/components/node-palette.tsx` | McpServer.connected 선택적화 |
| `web/src/pages/workflows/builder.tsx` | NodePalette import, state, toolbar 버튼, 콜백 |
| `web/src/styles/layout.css` | .node-palette* 클래스 추가 (~170줄) |
| `src/i18n/locales/en.json` | palette.open_tools_skills 키 추가 |
| `src/i18n/locales/ko.json` | palette.open_tools_skills 키 추가 |

## CSS 클래스

### 팝오버 구조
```css
.node-palette__backdrop     /* 투명 배경 (오버레이) */
.node-palette              /* 팝오버 컨테이너 */
├── .node-palette__search  /* 검색 입력 섹션 */
├── .node-palette__list    /* 아이템 리스트 (scrollable) */
│   └── .node-palette__group          /* 그룹 섹션 */
│       ├── .node-palette__group-header  /* 그룹 헤더 (토글 가능) */
│       │   ├── .node-palette__group-arrow
│       │   ├── .node-palette__group-name
│       │   ├── .node-palette__group-count
│       │   └── .node-palette__status  /* MCP 연결 상태 뱃지 */
│       └── .node-palette__item       /* 아이템 */
│           ├── .node-palette__item-icon
│           ├── .node-palette__item-name
│           └── .node-palette__item-desc
└── .node-palette__empty  /* 검색 결과 없음 상태 */
```

### 색상 및 상태
- `.node-palette__status--ok`: var(--ok) — MCP 연결됨
- `.node-palette__status--err`: var(--err) — MCP 연결 안 됨
- `.node-palette__item--active`: 키보드 포커스 또는 마우스 호버
- `.node-palette__item-desc`: 말줄임 (max-width 제약)

## 키보드 상호작용

| 키 | 동작 |
|----|------|
| ↑/↓ | 아이템 탐색 (cursor 이동) |
| Enter | 현재 아이템 선택 (onSelectTool/onSelectSkill 호출) |
| Esc | 팝오버 닫기 |
| 클릭 | 아이템 선택 또는 그룹 토글 |

## 상태 관리 (builder.tsx)

```typescript
const [paletteOpen, setPaletteOpen] = useState(false);
const paletteBtnRef = useRef<HTMLButtonElement>(null);

// 도구 선택
const handleSelectTool = (tool_id: string, description: string) => {
  const newNode: ToolNodeDef = {
    id: `tool-${idx}`,
    tool_id,
    description,
    attach_to: [firstPhaseId],
  };
  setWorkflow({ ...workflow, tool_nodes: [...old, newNode] });
  setPaletteOpen(false);
  setInspectorNodeId(`${firstPhaseId}__tool_${newNode.id}`);
};
```

## 사용 예시

### 버튼 클릭 흐름
1. 사용자 "[+ Tool / Skill]" 클릭
2. `paletteOpen = true` → NodePalette 렌더링
3. 사용자 검색어 입력 (예: "http")
4. 필터링된 아이템 표시 (http_request, http_proxy 등)
5. 아이템 클릭 또는 Enter → onSelectTool 호출
6. tool_nodes 배열에 새 노드 추가
7. 인스펙터에서 자동 선택 (편집 가능)
8. 팝오버 닫기

### 그룹 구조
```
┌─────────────────────────────────────┐
│ 🔍 Search tools & skills...         │
├─────────────────────────────────────┤
│ ▾ Built-in (5)                      │
│   🔧 shell_execute — Run shell...   │
│   🔧 http_request — HTTP call...    │
│ ▾ MCP: slack (3)             🟢     │
│   🔧 slack_post_message             │
│   🔧 slack_list_channels            │
│ ▾ MCP: github (2)             🔴   │
│   ⚡ github_search_code             │
│ ▾ Skills (2)                        │
│   ⚡ deploy — Deploy service        │
│   ⚡ hwpx — HWPX 문서 빌드          │
└─────────────────────────────────────┘
```

## 모바일 고려사항

- 팝오버 너비: 90vw (최대 100%)
- 높이: 최대 70vh (스크린 높이의 70%)
- 터치 타겟 최소 44px
- 검색 입력이 항상 보이도록 고정

## 성능 최적화

1. **쿼리 캐싱**: tools/skills는 60초 stale time으로 캐시
2. **메모이제이션**: build_items()는 useEffect 없이 각 렌더링에서 수행 (이미 캐시된 데이터)
3. **키보드 네비게이션**: 마우스 이벤트 버블링 방지 (e.stopPropagation)
4. **지연 인스펙터 선택**: setTimeout으로 다음 틱에 선택 (렌더링 순서 보장)

## 기존 기능과의 호환성

- **NodePicker**: 그래프 에디터 내 사이드 패널 노드 선택 (그대로 유지)
- **GraphEditor AddHandle**: 노드 간 연결 중 노드 추가 (그대로 유지)
- **Cron/Channel 버튼**: 별도 모달 (그대로 유지)

## 테스트 시나리오

1. ✅ "[+ Tool / Skill]" 클릭 → 팝오버 열림
2. ✅ 검색어 입력 → 실시간 필터링
3. ✅ MCP 서버별 그룹 표시 + 연결 상태 뱃지
4. ✅ 도구 클릭 → tool_node 추가 (description pre-fill)
5. ✅ 스킬 클릭 → skill_node 추가
6. ✅ 키보드 (↑↓ Enter) 네비게이션
7. ✅ Esc 또는 backdrop 클릭 → 팝오버 닫기
8. ✅ 추가된 노드가 인스펙터에서 자동 선택

## 향후 개선 사항

- [ ] 자주 사용한 도구/스킬 상단 고정
- [ ] 즐겨찾기 기능
- [ ] 도구 별 매개변수 힌트 (팁)
- [ ] 드래그 & 드롭으로 캔버스에 직접 추가
- [ ] 매크로 / 템플릿 노드 추가
