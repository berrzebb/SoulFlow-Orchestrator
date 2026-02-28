# Frontmatter Specification

SKILL.md의 YAML frontmatter 작성 규칙.

## Standard Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Skill name (hyphen-case, lowercase) |
| `description` | Yes | Primary trigger — "Use when..." 패턴 |

## Metadata Section

`metadata:` 안에 오케스트레이터 라우팅용 필드를 배치.

```yaml
metadata:
  model: local | remote
  always: true
  tools:
    - tool_name
  triggers:
    - 키워드
  aliases:
    - 대체이름
```

| Field | Type | Purpose |
|-------|------|---------|
| `model` | `local` \| `remote` | 실행 모델 요구 수준. `local`: 로컬 추론으로 충분, `remote`: 클라우드 모델 필요 |
| `always` | boolean | `true`면 모든 대화에 자동 로드 |
| `tools` | string[] | 스킬이 사용하는 도구 목록. 오케스트레이터가 도구 정의를 필터링할 때 사용 |
| `triggers` | string[] | 키워드 매칭용 단어/구문 (한국어 포함). description과 보완적 |
| `aliases` | string[] | 스킬의 대체 이름 |

## Description 작성법

Description은 스킬 로드 전 유일하게 에이전트가 읽는 정보. 최대한 상세하게.

### 필수 포함 요소

1. **What** — 스킬이 하는 일 (1문장)
2. **Use when** — 트리거 상황 열거
3. **Do NOT use when** — 명확한 제외 조건

### Good Example

```yaml
description: >-
  Create, read, edit, and manipulate Word documents (.docx files).
  Use when: any mention of 'Word doc', '.docx', requests for reports/memos/letters,
  working with tracked changes or comments, or converting content into Word format.
  Do NOT use for PDFs, spreadsheets, or Google Docs.
```

### Bad Example

```yaml
description: Handle documents
```

## Model 선택 기준

| 기준 | `local` | `remote` |
|------|---------|----------|
| 도구 호출 패턴 | 단순 매핑 (1 input → 1 tool call) | 다단계 추론 필요 |
| 스크립트 존재 | scripts/ 있고 --help로 실행 가능 | 에이전트가 코드 생성 필요 |
| 컨텍스트 의존성 | 낮음 (정형화된 워크플로우) | 높음 (사용자 의도 해석 필요) |
| 응답 시간 | 즉시 응답 기대 | 복잡한 작업 허용 |
