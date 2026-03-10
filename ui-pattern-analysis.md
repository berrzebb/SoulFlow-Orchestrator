# UI 패턴 분석 결과 (전체 프론트엔드 기준)

**분석 범위**:
- **176개 page 파일** (web/src/pages/)
  - channels/ (4개)
  - providers/ (6개)
  - oauth/ (5개)
  - workspace/ (12개)
  - workflows/ (135개: main 11개 + nodes/ 124개)
  - chat/ (6개)
  - overview/ (3개)
  - top-level (5개)
- **18개 shared components** (web/src/components/)
- **2개 hooks** (web/src/hooks/)
- **4개 CSS files** (web/src/styles/)

**분석 일시**: 2026-03-08
**분석 깊이**: 광범위 패턴 + 재사용 통계

---

## 1. 현황 분석

### 컴포넌트 분포

```
Shared Components:  18개 (높은 재사용율)
├─ Modal/Toast/Badge: 7-28회 사용
├─ Form (FormInput/FormLabel): 3-56회 사용
└─ 특화 (YamlEditor, SendAgentModal): 1회

Pages-Internal Components: 14개 (낮은 재사용율)
├─ Card + Modal 쌍: 5쌍 (10개)
│  ├─ instance-card + modal (channels)
│  ├─ provider-card + modal (providers)
│  ├─ connection-card + modal (providers)
│  ├─ oauth-card + modal (oauth)
│  └─ preset-card + modal (oauth)
└─ Standalone (section/bar): 4개

Hooks분포:
├─ use-test-mutation: 4회 (card들에서 사용)
└─ use-approvals: 2회 (chat, workflows)
```

### CSS 클래스 중복도

| 클래스 | 사용 횟수 | 타입 |
|-------|---------|------|
| label | 512회 | form |
| builder-row | 505회 | workflows 특화 |
| input input--sm | 375회 | form |
| form-input | 65회 | form |
| form-label | 56회 | form |
| empty-state | 28회 | state |
| stat-card | 5회 | card |

**결론**: 클래스 기반 스타일은 이미 좋으나, **컴포넌트 수준의 추상화 부족**

---

## 2. 발견된 중복 패턴 (재사용률 순)

### 1. **입력 바 컴포넌트군 (3가지 변형)** — 점수: 22 🔴 Critical
- **위치**:
  - `web/src/pages/chat/chat-input-bar.tsx` (textarea)
  - `web/src/pages/workflows/builder-bars.tsx` → WorkflowPromptBar (input)
  - `web/src/pages/workflows/builder-bars.tsx` → NodeRunInputBar (input)
- **현재 구현**:
  - 모두 다른 파일에 위치하고 비슷한 레이아웃만 공유
  - ChatInputBar: textarea 기반, 미디어 바 + 높이 자동조정 + 폴링
  - WorkflowPromptBar: input + API 호출 + 로딩 상태 표시
  - NodeRunInputBar: label + input + 버튼 2개
  - 모두 Enter 키 핸들링, 상태 관리 중복
- **재사용 가능성**: 높음 (근본 로직 동일)
- **복잡도**: 중간 (상태 관리, 이벤트 핸들링)

**통합 제안**:
```
InputBar 기본 컴포넌트 (web/src/components/input-bar.tsx)
  ├─ props: { variant, onSend, value, onChange, disabled, ... }
  ├─ variant: "chat" | "workflow-prompt" | "node-run" | "generic"
  └─ 각 variant는 스타일 + 추가 기능 구성
```

**예상 효과**:
- 중복 로직 제거: ~80줄
- 유지보수성: 향상 (한 곳에서만 수정)
- 컴포넌트 수: 3 → 1

---

### 2. **카드/Stat-Card 패턴 (3가지 구현)** — 점수: 24 🔴 Critical
- **위치**:
  - `web/src/pages/providers/provider-card.tsx` (ProviderCard)
  - `web/src/pages/channels/instance-card.tsx` (InstanceCard)
  - `web/src/pages/oauth/oauth-card.tsx` (OAuthCard)
- **현재 구현**:
  - 모두 동일한 `.stat-card` CSS 클래스 사용하지만 컴포넌트 분산
  - 구조: header (badge) → value → label → extra → tags → actions
  - 테스트 뮤테이션 hook (`useTestMutation`) 반복 사용
  - edit, remove, test 버튼 패턴 동일
  - Badge 컴포넌트 재사용 (Good)
- **재사용 가능성**: 높음 (구조 완전 동일)
- **복잡도**: 중간 (타입 제너릭, 슬롯 기반)

**통합 제안**:
```
StatCard 기본 컴포넌트 (web/src/components/stat-card.tsx)
  ├─ props: { status, title, subtitle, children?, actions }
  ├─ children: tags, extra 영역
  └─ actions: [{ label, onClick, loading, disabled, variant }]
```

**예상 효과**:
- 코드 중복 제거: ~180줄
- 일관된 외형 보장
- 새 카드 타입 추가 시간: 50% 단축

---

### 3. **테이블 렌더링 패턴 (2가지 구현)** — 점수: 20 🔴 Critical
- **위치**:
  - `web/src/components/data-table.tsx` (DataTable 컴포넌트 존재)
  - `web/src/pages/workspace/agents.tsx` (직접 table 마크업 x5)
- **현재 구현**:
  - DataTable 컴포넌트: 제너릭, Column 인터페이스, 깔끔한 구조
  - agents.tsx: 직접 `<table>`, `<thead>`, `<tbody>` 작성 반복
  - 검색/필터 UI: filter-bar + filter-input + ws-chip-bar 혼재
  - 토글/전개 기능: showCompleted, showRecentProcesses 등 중복
- **재사용 가능성**: 매우 높음 (DataTable 이미 있음!)
- **복잡도**: 낮음 (단순 마이그레이션)

**통합 제안**:
```
agents.tsx 리팩토링 (단계적):
1. 기존 DataTable 컴포넌트 사용으로 마이그레이션
2. 필터 UI 공통화 (FilterBar 컴포넌트)
3. 토글/확장 로직 추출 (useCollapsible 훅)
```

**예상 효과**:
- agents.tsx 라인 수: 386 → ~250 (35% 감소)
- 테이블 유지보수성 향상
- 검색/필터 일관성 개선

---

### 4. **모달 및 확인 대화** — 점수: 18 🟠 High
- **위치**:
  - `web/src/components/modal.tsx` → Modal, FormModal
  - `web/src/components/modal.tsx` → useConfirm 훅
  - `web/src/pages/oauth/oauth-card.tsx` → ConnectModal (내장)
- **현재 구현**:
  - Modal, FormModal: 완성된 컴포넌트, 접근성 + Esc 처리 Good
  - useConfirm: 올바른 훅 패턴
  - ConnectModal: 개별 구현 (재사용성 낮음)
  - agents.tsx: Modal 재사용 Good
- **재사용 가능성**: 높음 (이미 추상화됨)
- **복잡도**: 낮음 (기존 컴포넌트 이용)

**통합 제안**:
```
기존 Modal/FormModal 재사용 권장
- ConnectModal → FormModal로 변환 (agents.tsx 패턴 따라)
- useConfirm 훅 공식화 및 문서화
```

**예상 효과**:
- 새 모달 추가 시간: 10분 (기존: 30분)
- 일관된 UX 경험

---

### 5. **빈 상태 표시** — 점수: 15 🟠 High
- **위치**:
  - `web/src/components/empty-state.tsx` (EmptyState 컴포넌트 존재)
  - `web/src/pages/chat/message-list.tsx` (inline)
  - `web/src/pages/workspace/agents.tsx` (x5 inline)
  - `web/src/components/data-table.tsx` (inline)
- **현재 구현**:
  - EmptyState: 4가지 타입 (empty, loading, error, no-results), icon 지원
  - inline: `<div className="empty-state">...</div>` 패턴 반복
  - 일관성 낮음 (아이콘, 메시지 형식 다름)
- **재사용 가능성**: 높음 (EmptyState 이미 있음!)
- **복잡도**: 낮음

**통합 제안**:
```
EmptyState 컴포넌트 의무 사용
- agents.tsx의 모든 inline 대체
- data-table.tsx, message-list.tsx 마이그레이션
```

**예상 효과**:
- 빈 상태 일관성 100% 달성
- 유지보수 포인트 1개로 중앙화
- 코드: ~50줄 절감

---

### 6. **액션 버튼 조합** — 점수: 14 🟡 Medium
- **위치**: ProviderCard, InstanceCard, OAuthCard, agents.tsx 테이블들
- **현재 구현**:
  - 패턴: `btn btn--xs btn--danger` / `btn btn--xs btn--ok` / `btn btn--xs`
  - 구성: [edit, test, remove] 또는 [connect, refresh, test, remove]
  - 상태 관리: `testing`, `loading`, `disabled` 중복
  - useTestMutation 훅: 재사용 중 (Good)
- **재사용 가능성**: 중간 (각 카드마다 약간 다름)
- **복잡도**: 낮음

**통합 제안**:
```
ActionBar 컴포넌트 (web/src/components/action-bar.tsx)
  props: {
    actions: [{ id, label, onClick, variant, loading, disabled }]
  }
```

**예상 효과**:
- 버튼 그룹 UI 일관성 개선
- 스타일 중복 제거: ~30줄

---

### 7. **선택 드롭다운 (프로바이더/모델)** — 점수: 12 🟡 Medium
- **위치**: `web/src/components/provider-model-bar.tsx`
- **현재 구현**:
  - 2단계 선택: 프로바이더 → 모델 리스트 로드
  - useEffect 기반 데이터 로드, 취소 처리 (Good)
  - 상태: loadingInstances, loadingModels (중복 패턴)
- **재사용 가능성**: 낮음 (매우 특화됨)
- **복잡도**: 중간

**분석**: 현재 구현이 이미 좋으므로 우선순위 낮음. 유사한 패턴 (2단계 선택)이 다른 곳에 필요하면 그때 일반화.

---

### 8. **검색/필터 바** — 점수: 11 🟡 Medium
- **위치**: `web/src/pages/workspace/agents.tsx`
- **현재 구현**:
  - filter-bar: `<input type="search">` + 칩 버튼 그룹
  - 스타일: `.filter-bar`, `.filter-input`, `.ws-chip-bar`
  - 상태: search + statusFilter (2-axis 필터)
- **재사용 가능성**: 높음 (일반적 패턴)
- **복잡도**: 낮음

**통합 제안**:
```
FilterBar 컴포넌트 (web/src/components/filter-bar.tsx)
  props: {
    searchValue, onSearchChange,
    tabs: [{ id, label, selected, onClick }]
  }
```

**예상 효과**:
- agents.tsx 정리: ~30줄 절감
- 다른 필터 UI 표준화 가능

---

## 2. Phase 1 컴포넌트화 대상 (점수 15+ | 높은 영향도)

### 🎯 우선순위 Top 5

| 순위 | 패턴 | 점수 | 이유 |
|------|------|------|------|
| 1️⃣ | 입력 바 (InputBar) | 22 | 3가지 중복 + 로직 복잡 + 높은 재사용율 |
| 2️⃣ | 카드 (StatCard) | 24 | 3가지 동일 구조 + CSS 일관성 + 새 기능 추가 용이 |
| 3️⃣ | 테이블 렌더링 (DataTable 마이그레이션) | 20 | DataTable 이미 완성됨 + agents.tsx 5개 중복 |
| 4️⃣ | 빈 상태 (EmptyState 마이그레이션) | 15 | 컴포넌트 존재 + inline 패턴 7곳 |
| 5️⃣ | 액션 버튼 (ActionBar) | 14 | 모든 카드에서 반복 + 스타일 통일 |

---

## 3. 마이그레이션 순서 및 실행 계획

### Phase 1: 기존 컴포넌트 마이그레이션 (낮은 리스크)
**목표**: 기존 미사용 컴포넌트의 도입률 100%

1. **DataTable 마이그레이션** (3-4시간)
   - 대상: `web/src/pages/workspace/agents.tsx` (5개 table → DataTable)
   - 변경 범위: agents.tsx만
   - 테스트: 기존 테스트 + 스냅샷 검증
   - 효과: 코드 35% 감소

2. **EmptyState 마이그레이션** (2-3시간)
   - 대상: agents.tsx, chat/message-list, data-table.tsx, 기타 inline
   - 변경 범위: 7개 파일
   - 효과: 빈 상태 일관성 완성

3. **필터 바 추출 (FilterBar 컴포넌트)** (2시간)
   - 대상: agents.tsx의 filter-bar 로직 추출
   - 새 파일: `web/src/components/filter-bar.tsx`
   - 재사용: 다른 필터 UI 표준화 용도

### Phase 2: 새 컴포넌트 추출 (중간 리스크)
**목표**: 3개 핵심 중복 패턴 통합

4. **StatCard 컴포넌트** (3-4시간)
   - 대상: ProviderCard, InstanceCard, OAuthCard
   - 새 파일: `web/src/components/stat-card.tsx` (기존 클래스는 유지)
   - 마이그레이션: 3개 파일 동시 변경
   - 테스트: 스냅샷 + 인터랙션
   - 효과: 카드 일관성 + 유지보수 용이

5. **InputBar 컴포넌트** (4-5시간)
   - 대상: ChatInputBar, WorkflowPromptBar, NodeRunInputBar
   - 새 파일: `web/src/components/input-bar.tsx`
   - Props: `variant` + `onSend`, `value`, `onChange`
   - 마이그레이션: 3개 파일 변경 + 부모 컴포넌트 수정
   - 테스트: 각 variant 독립 테스트 + e2e
   - 효과: 입력 로직 중앙화

6. **ActionBar 컴포넌트** (2-3시간)
   - 대상: 모든 카드의 `.stat-card__actions`
   - 새 파일: `web/src/components/action-bar.tsx`
   - 선택: StatCard 추출 후 진행
   - 효과: 버튼 그룹 UI 표준화

---

## 4. CSS 스타일 정렬

### 현재 발견된 스타일 중복

| 스타일 클래스 | 사용 위치 | 통합 권장 |
|---|---|---|
| `.btn`, `.btn--xs`, `.btn--sm`, `.btn--ok`, `.btn--danger` | 모든 페이지 | 통일 + 문서화 (완료) |
| `.input`, `.input--sm` | 폼, 검색 | 통일 (완료) |
| `.stat-card`, `.desk--ok/off/warn` | 카드들 | 명명 규칙 정립 필요 |
| `.empty-state`, `.empty-state__icon` | 7곳 | 통일 (진행 중) |
| `.modal`, `.modal-overlay` | Modal 컴포넌트 | 현재 Good |
| `.filter-bar`, `.filter-input` | agents.tsx | FilterBar 컴포넌트화 |
| `.form-group`, `.form-label`, `.form-input` | 폼 | 통일 (Good) |

### 권장 사항
- **명명 규칙 강화**: `stat-card`, `desk` 혼용 → `stat-card` 통일
- **CSS 변수 사용 확대**: 컬러, 간격 변수화 (이미 진행 중)
- **스타일 레이어 분리**: 레이아웃(layout.css) vs 컴포넌트(component.css)

---

## 5. 영향받는 파일 목록 (전체 범위)

### 컴포넌트 파일
```
web/src/components/
├── badge.tsx (재사용 Good)
├── modal.tsx (기본 Good, ConnectModal 제거 대상)
├── form-input.tsx (기본 Good)
├── data-table.tsx (마이그레이션 대상)
├── empty-state.tsx (마이그레이션 대상)
├── toast.tsx (기본 Good)
├── provider-model-bar.tsx (특화된 컴포넌트, 유지)
│
├─ [신규] stat-card.tsx (Phase 2)
├─ [신규] input-bar.tsx (Phase 2)
├─ [신규] action-bar.tsx (Phase 2)
├─ [신규] filter-bar.tsx (Phase 1)
```

### 페이지 파일 (마이그레이션 대상)
```
web/src/pages/
├── chat/
│   ├── chat-input-bar.tsx → InputBar variant로 통합
│   ├── message-list.tsx → EmptyState 마이그레이션
│   └── empty-state.tsx → 삭제 (EmptyState 컴포넌트 사용)
│
├── workflows/
│   └── builder-bars.tsx → InputBar 2개 variant로 통합
│
├── providers/
│   └── provider-card.tsx → StatCard 컴포넌트로 변환
│
├── channels/
│   └── instance-card.tsx → StatCard 컴포넌트로 변환
│
├── oauth/
│   ├── oauth-card.tsx → StatCard 컴포넌트로 변환
│   └── oauth-modal.tsx (현황 파악 필요)
│
└── workspace/
    └── agents.tsx → DataTable + EmptyState + FilterBar 마이그레이션
```

---

## 6. 테스트 전략

### Unit Tests
- 각 신규 컴포넌트 (InputBar, StatCard, ActionBar, FilterBar)
- Props 검증 + variant 동작 테스트
- 접근성 (a11y) 검증

### Integration Tests
- agents.tsx DataTable 마이그레이션 검증
- 필터/검색 상호작용
- 모달 통합 (Form + Confirm)

### E2E Tests (낮은 우선순위)
- 채팅 입력 → 메시지 전송
- 워크플로우 편집 bar
- 프로바이더 카드 CRUD

---

## 7. 구현 예상 일정

| Phase | 작업 | 기간 | 위험도 |
|-------|------|------|--------|
| 1 | DataTable 마이그레이션 | 3-4h | 🟢 낮음 |
| 1 | EmptyState 마이그레이션 | 2-3h | 🟢 낮음 |
| 1 | FilterBar 추출 | 2h | 🟡 중간 |
| **소계** | **Phase 1** | **~9h** | |
| 2 | StatCard 컴포넌트 + 마이그레이션 | 3-4h | 🟡 중간 |
| 2 | InputBar 컴포넌트 + 마이그레이션 | 4-5h | 🟡 중간 |
| 2 | ActionBar 컴포넌트 + 마이그레이션 | 2-3h | 🟡 중간 |
| **소계** | **Phase 2** | **~11h** | |
| **전체** | **완료** | **~20h** | **중간** |

---

## 8. 기대 효과

### 정량적 효과
- **코드 중복 제거**: ~350줄 절감 (5-7%)
- **컴포넌트 수**: +3개 (stat-card, input-bar, action-bar)
- **마이그레이션 대상**: 12개 파일

### 정성적 효과
- UI 일관성 향상 (스타일 + 동작)
- 유지보수성 개선 (공통점 중앙화)
- 새 기능 추가 시간 40% 단축
- 접근성 일관성 (모든 버튼, 폼, 모달 표준화)

---

## 9. 주의사항

1. **CSS 네이밍**: `.stat-card`, `.desk` 혼용 정정 필수
2. **TypeScript 제너릭**: StatCard에 제너릭 파라미터 추가 고려
3. **역할 분리**: stat-card 컴포넌트 vs stat-card.css 스타일 명확화
4. **레거시 호환**: 마이그레이션 후 기존 props 지원 (deprecation 알림)
5. **테스트 커버리지**: Phase 2 이후 스냅샷 테스트 추가 권장

---

## 10. 참고

- **현재 프로젝트 구조**: SPA (React) + 모듈식 페이지
- **접근성 수준**: 기본 a11y 준수 (aria-label, focus 관리)
- **성능**: 현재 양호 (컴포넌트화 후 개선 예상)
- **브라우저 호환성**: 최신 3개 버전 (CSS Grid, Flexbox 사용 가능)
