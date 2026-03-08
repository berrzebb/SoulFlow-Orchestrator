# 설계: 스킬 자동 매칭 + 완료 후 체크 + 프로젝트 문서 프로토콜

> **Status**: `planned` | **Type**: 기능 추가

## 개요

멀티에이전트 오케스트레이션에서 3가지 장치를 추가하여 작업 품질과 자동화를 강화:

1. **SkillIndex** — 사용자 지시 분석 → FTS5 기반 4차원 스킬 자동 매칭
2. **CompletionChecker** — 작업 중(셀프체크 리마인더) + 작업 후(사용자 follow-up) 체크 질문
3. **프로젝트 문서 프로토콜** — 칸반 보드를 단일 원천으로, 역할 체인이 계획서/맥락노트/체크리스트를 관리

### 핵심 원칙

- **프론트메터만 보고 선택** — 스킬 전체를 읽는 건 낭비. 프론트메터로 매칭 → 선택된 스킬의 body(facade)만 주입
- **스킬 = Facade** — SKILL.md body는 상황별 레퍼런스 라우팅 테이블
- **레퍼런스 3종** — 공유(`_shared/`), 스킬 특화(`references/`), 분기용(라우팅 테이블)
- **혼합 체크** — 스킬 정의 체크리스트(frontmatter) + 동적 보완(도구 사용 패턴 기반)

## 문제

### 스킬 매칭

`suggest_skills_for_text()` — 단순 `String.includes()` 키워드 매칭 (name:6, alias:4, trigger:5, summary:1).
의도, 파일 타입, 코드 패턴 등 문맥 신호를 활용하지 못함.

### 완료 체크 부재

에이전트가 작업을 완료해도 결과물의 품질/안전성을 검증하는 장치가 없음.
파일 수정 후 에러 핸들링 누락, 보안 취약점 등을 사후에 발견.

### 역할 간 협업 기준 부재

멀티에이전트 워크플로우에서 역할(PM, PL, Implementer, Reviewer, Validator) 간 작업 분배와 완료 기준이 불명확.

---

## 장치 1: SkillIndex

### 아키텍처

```
                    ┌──────────────┐
                    │ SkillService │
                    │  (N skills)  │
                    └──────┬───────┘
                           │ build()
                    ┌──────▼───────┐
                    │  SkillIndex  │
                    │ (injected)   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  SQLite DB   │
                    │  FTS5 + WAL  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐ ┌────▼────┐ ┌─────▼─────┐
         │skill_docs│ │ intent  │ │skills_fts │
         │ (master) │ │patterns │ │  (FTS5)   │
         └─────────┘ └─────────┘ └───────────┘
```

### DB 스키마

```sql
CREATE TABLE skill_docs (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, triggers TEXT, aliases TEXT,
  summary TEXT, intents TEXT, file_pats TEXT, code_pats TEXT
);
CREATE VIRTUAL TABLE skills_fts USING fts5(
  name, triggers, aliases, summary, intents, file_pats, code_pats,
  content='skill_docs', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

### 4차원 스코어링

| 차원 | 소스 | 점수 | 방식 |
|------|------|------|------|
| Keyword | triggers, aliases, name | BM25 (FTS5) | 기존 키워드 매칭의 FTS5 업그레이드 |
| Intent | intents 필드 | +3/match | 정규식 패턴 → 의도 분류 → intents 매칭 |
| File path | file_patterns 필드 | +4/match | 요청에서 파일 확장자 추출 → glob 매칭 |
| Code pattern | code_patterns 필드 | +3/match | 코드 키워드/라이브러리명 감지 |

### Intent 패턴 (정규식, LLM 호출 없음)

```typescript
// src/orchestration/intent-patterns.ts
const INTENT_PATTERNS: Record<string, RegExp[]> = {
  generate_document: [/만들어|생성|작성|create|generate|make/i, /파일|문서|보고서/i],
  analyze_data: [/분석|통계|데이터|analyze|data/i],
  search_web: [/검색|찾아|search|find/i],
  execute_code: [/실행|코드|스크립트|run|execute/i],
  version_control: [/커밋|PR|이슈|commit|branch/i],
};
```

### SKILL.md 프론트메터 확장

```yaml
metadata:
  intents: [generate_document]
  file_patterns: ["*.pdf", "*.pptx"]
  code_patterns: [python, pandas]
  checks:
    - 생성된 파일이 정상적으로 열리는지 확인했나요?
    - 한글 폰트가 깨지지 않았나요?
```

### 통합 지점

`AgentDomain.recommend_skills()` 구현 교체:

현재 호출 체인: `OrchestrationService` → `runtime.recommend_skills()` → `AgentDomain.recommend_skills()` → `suggest_skills_for_text()`.
OrchestrationService를 직접 수정하지 않고, **AgentDomain/RuntimeService의 추천 구현을 SkillIndex로 교체**:

```typescript
// BEFORE: AgentDomain.recommend_skills() → suggest_skills_for_text()
// AFTER:  AgentDomain.recommend_skills() → this.skill_index.select()
```

이렇게 하면 OrchestrationService의 `resolve_context_skills()`는 변경 없이 동작.

---

## 장치 2: CompletionChecker

### 체크 소스 2가지

**A. 스킬 정의 체크** (frontmatter `checks:`):
- 매칭된 스킬 중 실제 도구가 사용된 스킬의 `checks[]` 수집

**B. 동적 체크** (도구 사용 패턴 기반):

| 조건 | 체크 질문 |
|------|----------|
| write_file/edit_file 사용 | 변경된 파일의 내용이 의도와 일치하나요? |
| exec/Bash 사용 | 실행 결과에 에러가 없었나요? |
| web_search/web_fetch 사용 | 검색 결과의 출처가 신뢰할 수 있나요? |
| task 모드 + tool_calls > 10 | 최종 결과물을 전체적으로 검토했나요? |
| secret/oauth 도구 사용 | 민감한 정보가 노출되지 않았나요? |

중복 제거 + 최대 5개. 스킬 정의 체크 우선.

### 셀프체크 리마인더 (Mid-task)

파일 변경 도구 실행 직후, 비차단 체크 질문을 제시 — **"옆자리 선배" 패턴**.

> **Note**: 현재 `PostToolHook`은 void 반환이므로 in-loop 시스템 메시지 삽입은 불가.
> 아래는 **갈래 B(향후)** 구현 시 목표 흐름이며, 갈래 A에서는 체크 질문을 누적 후 완료 시 한꺼번에 제시.

```
[갈래 B 목표 흐름]
에이전트: write_file("src/store.ts") 실행
    ↓
셀프체크 리마인더 (tool_result에 append):
  "방금 수정한 파일에서 확인할 것:"
  ✓ 오류 처리는 추가했나요?
  ✓ 보안상 위험한 부분은 없나요?
    ↓
에이전트: "아 맞다, 에러 핸들링 빠졌네" → 자가 보완 수행
```

### 7단계 자동 검사 흐름

```
① 지시 내리기 (사용자 메시지)
    ↓
② 매뉴얼 자동 전달 (SkillIndex → 스킬 facade + references 주입)
    ↓
③ AI 작업 수행 (코드 생성/수정)
    ↓
④ 파일 자동 기록 (변경 파일 목록 + diff 수집)
    ↓
⑤ 오류 자동 검사 (lint, type-check, build)
    ↓
⑥ 셀프체크 리마인더 ("이것도 확인했어?")
    ↓
⑦ AI 바로 수정 (자가 보완)
    ↓
반복 (③~⑦) until 완료 → 사용자에게 follow-up 체크 질문
```

### 훅 통합: 두 갈래 전략

기존 `PostToolHook`(`tools/types.ts:75`)은 `void` 반환이며, `tool-loop-helpers.ts:56`에서 `swallow()`로 소비.
현재 훅 계약으로는 **진행 중 루프에 체크 메시지를 다시 주입할 수 없음**.

**갈래 A: Out-of-band 체크 기록 (현재 훅 계약 유지)**
- `post_tool_use`에서 도구 사용 기록 + 체크 점수를 누적
- 최종 완료 시 CompletionChecker가 누적 데이터로 follow-up 질문 생성
- 구현 비용 낮음, 즉시 가능

**갈래 B: In-loop self-check (새로운 주입 채널 설계 필요)**
- 별도 `tool_result_feedback` 주입 채널을 신규 설계
- PostToolHook이 반환한 문자열을 다음 턴의 시스템 메시지로 삽입
- 또는 `PostToolHook` 시그니처를 `string | void`로 확장하고, 백엔드 루프에서 반환값을 tool_result에 append
- 구현 비용 높음, 백엔드 3종(claude-sdk, codex-appserver, tool-loop-helpers) 모두 수정 필요

```typescript
// 갈래 A: 현재 계약 유지 — side effect로 기록만
post_tool_use: (name, params, result, ctx) => {
  this.tools_accumulator.push(name);
  // 체크 질문은 완료 시 한꺼번에
};

// 갈래 B: 시그니처 확장 (향후)
type PostToolHook = (...) => Promise<string | void> | string | void;
// 반환값이 string이면 tool_result에 append → 에이전트가 다음 턴에서 읽음
```

**결정**: Phase 3에서 갈래 A를 먼저 구현. 갈래 B는 실제 셀프체크 효과 검증 후 별도 설계.

---

## 장치 3: 프로젝트 문서 프로토콜

### 칸반 보드 = 단일 원천 (Single Source of Truth)

| 문서 | 저장 위치 | 작성 역할 |
|------|----------|----------|
| **계획서** | Board description | PM (설계자) |
| **맥락 노트** | Card description | PL (분배자) |
| **체크리스트** | Card subtasks + comments | Reviewer + Validator |

### 역할 체인

```
PM (설계자) → 계획서 작성 → kanban("create_board")
    ↓
PL (분배자) → 작업 분배 + 맥락 노트 → kanban("create_card") × N
    ↓
Implementer (구현자) → 작업 수행 → kanban("move_card", "in_review")
    ↓
Reviewer (리뷰어) → 코드 리뷰 체크리스트 → 통과/반환
    ↓
Validator (검증자) → 빌드/테스트/lint → 자동수정 or 에스컬레이션
```

### 작업 분배: 순차 실행

PL은 전체 카드를 todo에 등록하되, **적당량만** in_progress로 이동.
의존성/복잡도/WIP 제한 기반으로 판단.

### 팀 프리셋

| 팀 | 역할 구성 | 책임 |
|---|----------|------|
| **기획팀** | PM | 계획 수립, 계획 검토, 문서 작성 |
| **품질관리팀** | Reviewer + (Implementer) | 코드 검토, 오류 수정, 구조 개선 |
| **테스트팀** | Validator | 기능 테스트, 오류 진단, 화면 확인 |

풀 팀: `PM → PL → Implementer → Reviewer → Validator`
라이트: `PM → Implementer → Validator`

### 구조화된 보고서

모든 에이전트 피드백은 3요소 필수:
- **무엇을 발견했는지** — 현상/문제 기술
- **무엇을 수정했는지** — 변경 사항 구체 기술
- **왜 그렇게 판단했는지** — 근거/기준/맥락

### Validator 분기 로직

```
오류 자동 체크 (빌드/테스트/lint)
    ↓
┌─ 오류 적음 → AI 즉시 수정 → 재검증 → done
└─ 오류 많음 → Implementer에게 반환 (오류 목록 + 수정 방향)
```

이 분기 로직은 워크플로우 노드로 표현 가능해야 함.

---

## 데이터 흐름

### Pre-execution (스킬 매칭)

```
User Message → OrchestrationService.execute()
    → resolve_context_skills(task)
        → runtime.recommend_skills(task, 8)
            → AgentDomain.recommend_skills()
                → SkillIndex.select(task, {file_hints, code_hints})
                    ├→ FTS5 BM25
                    ├→ Intent pattern matching
                    ├→ File extension matching
                    └→ Code pattern matching
    → load_skills_for_context() ← body(facade)만
    → System prompt 주입
```

### Mid-task (갈래 A: out-of-band 기록)

```
에이전트 루프:
  tool_call(write_file) → AgentHooks.post_tool_use()
    → tools_accumulator에 도구명 + 체크 점수 누적
    → (루프에는 개입하지 않음)
    ↓
작업 완료 시:
  CompletionChecker.check(accumulator) → follow-up 질문 생성
```

> **갈래 B(향후)**: `PostToolHook` 시그니처 확장 후 tool_result에 체크 질문 append → 에이전트 자가 보완

### Post-completion (체크)

```
OrchestrationResult → 채널 응답 finalize 경로
    → CompletionChecker.check()
    → 최대 5개 질문 follow-up 메시지
```

> **Note**: 구체적 메서드(`deliver_result()`)가 아닌 "채널 응답 finalize 경로"로 표현.
> 내부 구조 분해 시 경로가 변경될 수 있으므로, 메서드명을 계약으로 고정하지 않음.

---

## 영향 파일

### 신규

| 파일 | 설명 |
|------|------|
| `src/orchestration/skill-index.ts` | FTS5 기반 4차원 스킬 매처 |
| `src/orchestration/completion-checker.ts` | 완료 후 체크 질문 생성기 |
| `src/orchestration/intent-patterns.ts` | Intent 정규식 + 파일/코드 추출 유틸 |
| `src/skills/_shared/project-docs-protocol.md` | 프로젝트 문서 프로토콜 |
| `src/skills/_shared/report-format-protocol.md` | 구조화된 보고서 형식 |
| `src/skills/_shared/team-presets.md` | 팀 프리셋 정의 |
| `src/skills/roles/*/references/*-template.md` | 역할별 문서 템플릿 |

### 수정

| 파일 | 변경 |
|------|------|
| `src/agent/skills.types.ts` | intents, file_patterns, code_patterns, checks, project_docs 추가 (shared_protocols는 이미 존재) |
| `src/agent/skills.service.ts` | 새 프론트메터 필드 파싱 |
| `src/agent/index.ts` (`AgentDomain.recommend_skills()`) | `suggest_skills_for_text()` 호출을 `SkillIndex.select()`로 교체 |
| 채널 응답 finalize 경로 | CompletionChecker 통합 (구조 분해 후 확정될 경로) |
| `src/skills/roles/*/SKILL.md` | project_docs 추가 (shared_protocols는 이미 존재) |

### tools_used 소유권 (Source of Truth)

`tools_used`는 이미 여러 곳에 존재:
- `memory.types.ts:42` — `MemoryEntry.tools_used`
- `session/types.ts:8` — `SessionMessage.tools_used`

**결정**: `SessionMessage.tools_used`를 source of truth로 사용.
- CompletionChecker는 세션 레벨의 tools_used를 참조
- OrchestrationResult에 중복 필드를 추가하지 않고, `matched_skills`만 추가
- MemoryService는 세션 데이터를 읽어 메모리에 반영 (기존 흐름 유지)

**주의: tools_used 기록 경로가 현재 없음.**
- `session/service.ts:225`의 `append_message()`는 `SessionMessage`를 저장하지만,
  현재 호출자들이 `tools_used` 필드를 채우지 않음
- **Phase 1에서 capture path 추가 필요:**
  - `post_tool_use` 훅에서 task/session scope별 accumulator에 도구명 기록
  - assistant 메시지 저장 시 accumulator의 내용을 `tools_used`에 포함

---

## 아키텍처 제약

- **SkillIndex는 AgentDomain/RuntimeService에 주입** — 전역 singleton 금지. `AgentDomain.recommend_skills()` 구현을 교체하여 OrchestrationService는 변경하지 않음
- **CompletionChecker도 주입형** — 채널 응답 finalize 경로에서 사용하되, 구체적 메서드명에 의존하지 않음
- **mid-task 셀프체크는 두 갈래** — 현재 `PostToolHook`은 void 반환이라 in-loop 주입 불가. 갈래 A(out-of-band 기록)를 먼저 구현, 갈래 B(시그니처 확장)는 효과 검증 후
- **tools_used 기록 경로 필요** — `SessionMessage.tools_used`는 타입만 존재하고 실제 write path가 없음. Phase 1에서 `post_tool_use` → accumulator → `append_message` 경로 추가
- **tools_used 중복 금지** — `SessionMessage.tools_used`를 source of truth로. OrchestrationResult에는 `matched_skills`만 추가
- **shared_protocols 이미 존재** — `skills.types.ts:24`에 정의됨. 역할 스킬 수정 시 "추가"가 아니라 "값 설정"
- **구조 분리 진행 중** — orchestration/service.ts와 channels/manager.ts를 동시에 건드리지 않도록, 구조 분해 완료 후 변경면을 최소화

---

## 구현 순서

### Phase 1: 타입 + 파싱 + tools_used 기록 경로
1. `skills.types.ts` — intents, file_patterns, code_patterns, checks, project_docs 추가
2. `skills.service.ts` — 프론트메터 파싱 확장
3. `orchestration/types.ts` — matched_skills 추가 (tools_used는 session 레벨 기존 필드 사용)
4. tools_used capture path 구현:
   - `post_tool_use` 훅에서 scope별 accumulator에 도구명 기록
   - assistant 메시지 저장(`append_message`) 시 accumulator → `SessionMessage.tools_used`

### Phase 2: SkillIndex
1. `intent-patterns.ts` — Intent 정규식, 파일/코드 패턴 추출기
2. `skill-index.ts` — FTS5 빌드 + 4차원 select
3. `tests/orchestration/skill-index.test.ts`
4. `AgentDomain.recommend_skills()` 구현을 SkillIndex로 교체 (OrchestrationService 변경 없음)

### Phase 3: CompletionChecker (갈래 A — out-of-band)
1. `completion-checker.ts` — 스킬 체크 수집 + 동적 규칙 (SessionMessage.tools_used 참조)
2. `tests/orchestration/completion-checker.test.ts`
3. 채널 응답 finalize 경로에 follow-up 발행 연결 (구조 분해 완료 후 경로 확정)

### Phase 3b: In-loop self-check (갈래 B — 후순위)
1. `PostToolHook` 시그니처를 `string | void`로 확장 검토
2. 백엔드 3종(claude-sdk, codex-appserver, tool-loop-helpers) 반환값 처리 추가
3. 셀프체크 효과 A/B 테스트 후 결정

### Phase 4: SKILL.md 프론트메터 보강
1. 우선순위 스킬에 intents, file_patterns, code_patterns, checks 추가

### Phase 5: 프로젝트 문서 프로토콜
1. 공유 프로토콜 + 역할별 템플릿 작성
2. 칸반 보드 연동 가이드

---

## 검증

1. **SkillIndex**: "PDF 보고서 만들어줘" → `file-maker` 매칭, "파이썬으로 분석해줘" → `sandbox` 매칭
2. **CompletionChecker**: file-maker + write_file → "파일이 정상인지 확인?" 체크 질문
3. **통합**: 메시지 → 스킬 매칭 → 에이전트 실행 → 체크 질문 follow-up
4. **프로젝트 문서**: 워크플로우 + PM 역할 → 칸반 보드 자동 생성
