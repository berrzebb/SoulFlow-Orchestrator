# 설계: 공유 i18n 프로토콜 — 통합 다국어 인프라

> **상태**: 완료 — 5개 Phase 전체 구현 (인프라 · 자동화 · 도구/노드 통합 · 렌더링 · 정리)

## 개요

파편화된 i18n 시스템(3개 분리 소스, 900+ 키 수동 동기화)을 **단일 소스 오브 트루스** JSON 기반 프로토콜로 교체. 프론트엔드와 백엔드가 공유하며, 자동화 도구가 누락/고아 키를 감지.

## 문제

현재 i18n은 새 기능마다 **3개 이상 파일 수정** 필요:

| 소스 | 형식 | 키 수 | 사용처 |
|------|------|-------|--------|
| `web/src/i18n/en.ts` | TS Record | ~450 | 프론트엔드 UI |
| `web/src/i18n/ko.ts` | TS Record | ~450 | 프론트엔드 UI |
| `web/src/i18n/tool-descriptions.ts` | 별도 TS | ~22 도구 × 2 언어 | 도구 페이지 |
| 백엔드 Tool 클래스 | 하드코딩 `readonly description` | ~60 도구 | LLM 도구 스키마 |
| 노드 descriptor | 하드코딩 `toolbar_label`, 스키마 설명 | ~76 노드 | 워크플로우 에디터 |

**문제점:**
1. 기능당 3파일 수정 → 높은 마찰, 누락 쉬움
2. 누락 키 감지 없음 → 키 문자열로 사일런트 폴백
3. 도구 설명이 FE i18n과 BE 하드코딩 사이에 중복
4. 노드 descriptor에 i18n 없음 (영어 전용 `toolbar_label`, `description`)
5. 새 언어 추가 시 모든 파일 수정 필요

## 아키텍처

### 단일 소스 오브 트루스

```
src/i18n/
├── protocol.ts              ← 공유 타입 + create_t() (FE & BE)
├── index.ts                 ← 백엔드 진입점 (JSON 로드, t 내보내기)
└── locales/
    ├── en.json              ← 전체 영어 번역 (플랫 키)
    └── ko.json              ← 전체 한국어 번역
    └── {locale}.json        ← 향후: ja.json, zh.json, ...

web/src/i18n/
├── index.tsx                ← React 프로바이더 (공유 JSON + 프로토콜 import)
└── (en.ts, ko.ts, tool-descriptions.ts → 마이그레이션 후 삭제)
```

### 키 네임스페이스 규칙

| 접두사 | 도메인 | 예시 |
|--------|--------|------|
| `common.*` | 공통 UI 문자열 | `common.save`, `common.cancel` |
| `nav.*` | 내비게이션 | `nav.overview`, `nav.chat` |
| `workflows.*` | 워크플로우 빌더 UI | `workflows.llm_backend`, `workflows.add_node` |
| `tool.{이름}.desc` | 도구 설명 | `tool.exec.desc` |
| `tool.{이름}.param.{매개변수}` | 도구 매개변수 설명 | `tool.exec.param.command` |
| `node.{타입}.label` | 노드 툴바 라벨 | `node.git.label` |
| `node.{타입}.desc` | 노드 설명 | `node.git.desc` |
| `node.{타입}.input.{필드}` | 노드 입력 필드 설명 | `node.git.input.operation` |
| `node.{타입}.output.{필드}` | 노드 출력 필드 설명 | `node.git.output.stdout` |
| `cat.{id}` | 노드 카테고리 라벨 | `cat.flow`, `cat.ai` |

### 공유 프로토콜 (`src/i18n/protocol.ts`)

```typescript
export type Locale = "en" | "ko";
export type TranslationDict = Record<string, string>;
export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function create_t(dict: TranslationDict, fallback?: TranslationDict): TFunction;
export function parse_locale(value: unknown): Locale;
```

### 백엔드 사용 (`src/i18n/index.ts`)

```typescript
import en from "./locales/en.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };

const DICTS: Record<Locale, TranslationDict> = { en, ko };

export function set_locale(locale: Locale): void;
export function get_t(locale?: Locale): TFunction;
export function t(key: string, vars?): string;  // current_locale 사용
```

### 프론트엔드 사용 (`web/src/i18n/index.tsx`)

```typescript
import en from "../../src/i18n/locales/en.json";
import ko from "../../src/i18n/locales/ko.json";
import { create_t, type Locale } from "../../src/i18n/protocol";

// React 컨텍스트가 로케일 전환 + t() 함수 제공
// 공유 프로토콜의 동일한 create_t() 사용
```

### 노드 Descriptor i18n 통합

```typescript
// 변경 전: 하드코딩 영어
export const git_descriptor = {
  toolbar_label: "+ Git",
  output_schema: [
    { name: "stdout", type: "string", description: "Command stdout" },
  ],
};

// 변경 후: i18n 키 참조 (렌더링 시 t()로 해석)
export const git_descriptor = {
  toolbar_label: "node.git.label",  // i18n 키
  output_schema: [
    { name: "stdout", type: "string", description: "node.git.output.stdout" },
  ],
};
```

## 자동화 도구 (`scripts/i18n-sync.ts`)

### 기능

1. **스캔** — FE/BE 소스에서 모든 `t("key")` 호출 추출
2. **도구 스캔** — `src/agent/tools/*.ts`에서 도구명 추출
3. **노드 스캔** — `web/src/pages/workflows/nodes/*.tsx`에서 노드 타입 추출
4. **비교** — 스캔된 키 vs `en.json` / `ko.json` 대조
5. **보고** — 누락 키, 고아 키, 미번역 ko 키 출력
6. **생성** — 누락 키에 스텁 자동 생성 (EN값 = 키, KO = EN 복사)

### 사용법

```bash
# 보고 모드 (기본): 누락/고아 키 표시
npx tsx scripts/i18n-sync.ts

# 생성 모드: 누락 키에 스텁 추가
npx tsx scripts/i18n-sync.ts --fix

# 검사 모드 (CI): 누락 키 있으면 exit 1
npx tsx scripts/i18n-sync.ts --check
```

### 출력 예시

```
[i18n-sync] 소스 스캔 중...
  t() 호출 588건 (80개 파일)
  백엔드 도구 60개
  프론트엔드 노드 76개

[i18n-sync] en.json 검사...
  ✓ 정의된 키 1,200개
  ✗ 누락 키 15개:
    - node.docker.label
    - node.docker.desc
    - tool.web_auth.desc
    ...
  ⚠ 고아 키 3개 (정의됐지만 미사용):
    - workflows.old_feature
    ...

[i18n-sync] ko.json 검사...
  ✗ 미번역 키 42개 (en에 있지만 ko에 없음)
```

## 마이그레이션 계획

### Phase 1: 인프라 (현재)
- [x] `src/i18n/protocol.ts` — 공유 타입 + `create_t()`
- [ ] `scripts/i18n-migrate.ts` — 기존 TS → JSON 변환
- [ ] `src/i18n/locales/en.json`, `ko.json` — 마이그레이션으로 생성
- [ ] `src/i18n/index.ts` — 백엔드 진입점
- [ ] `web/src/i18n/index.tsx` — 공유 JSON 사용하도록 리팩터

### Phase 2: 자동화
- [ ] `scripts/i18n-sync.ts` — 스캔 + 비교 + 보고 + 생성

### Phase 3: 도구 통합
- [ ] 백엔드 도구: `description` → i18n 키 참조
- [ ] `web/src/i18n/tool-descriptions.ts` 삭제

### Phase 4: 노드 통합
- [ ] 노드 descriptor: `toolbar_label` + 스키마 설명 → i18n 키
- [ ] 노드 카테고리 라벨 → i18n 키
- [ ] `i18n-sync.ts --fix`로 누락 노드/도구 스텁 생성

### Phase 5: 정리
- [ ] `web/src/i18n/en.ts`, `web/src/i18n/ko.ts` 삭제
- [ ] `tsc --noEmit` 검증

## 영향 파일

| 파일 | 변경 |
|------|------|
| `src/i18n/protocol.ts` | **신규** — 공유 타입 |
| `src/i18n/index.ts` | **신규** — 백엔드 진입점 |
| `src/i18n/locales/en.json` | **신규** — 영어 번역 |
| `src/i18n/locales/ko.json` | **신규** — 한국어 번역 |
| `web/src/i18n/index.tsx` | **수정** — 공유 JSON 사용 |
| `web/src/i18n/en.ts` | **삭제** (Phase 5) |
| `web/src/i18n/ko.ts` | **삭제** (Phase 5) |
| `web/src/i18n/tool-descriptions.ts` | **삭제** (Phase 3) |
| `scripts/i18n-migrate.ts` | **신규** — 일회성 마이그레이션 |
| `scripts/i18n-sync.ts` | **신규** — 지속적 자동화 |
| `src/agent/tools/base.ts` | **수정** — i18n 인식 description |
| `web/src/pages/workflows/node-registry.ts` | **수정** — i18n 키 지원 |
| 76× `web/src/pages/workflows/nodes/*.tsx` | **수정** — descriptor에 i18n 키 |
| 60× `src/agent/tools/*.ts` | **수정** — i18n 키 description |

## 설계 결정

### 왜 플랫 JSON인가? (중첩 아님)
- 현재 시스템이 이미 플랫 도트 표기 키 사용 (`"workflows.llm_backend"`)
- 플랫 키가 검색 간편 (`grep "tool.exec.desc"`)
- 객체 병합 시 키 충돌 위험 없음
- 기존 `t()` 함수 시그니처와 직접 호환

### 왜 파일별 colocated i18n이 아닌가?
- 검토: 각 노드/도구가 `{ en: {...}, ko: {...} }` 인라인 정의
- 기각: 새 언어 추가 시 140+ 파일 수정 필요
- 중앙 JSON: `ja.json` 추가 → 끝, 소스 파일 변경 없음

### 왜 JSON인가? (TS 아님)
- JSON은 언어 무관 — 향후 Python/Go 서비스에서도 소비 가능
- 빌드 단계 불필요 — 백엔드가 직접 읽음
- Vite가 JSON을 네이티브 임포트
- JSON Schema로 검증 가능

### 백엔드 도구 설명과 i18n
- 도구 설명은 LLM API 호출에 포함 — 항상 영어
- Tool 클래스의 `description` 필드는 영어 유지 (LLM 대상)
- i18n 키 (`tool.{이름}.desc`)는 **대시보드 UI 표시용**만
- 런타임 성능 우려 없음 — 설명은 스키마 생성 시 1회 해석
