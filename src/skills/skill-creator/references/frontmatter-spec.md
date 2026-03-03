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
| `tools` | string[] | 스킬이 사용하는 도구 목록. 오케스트레이터가 도구 필터링에 사용. **반드시 정확히 선언** |
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
description: Create, read, edit, and manipulate Word documents (.docx files). Use when: any mention of 'Word doc', '.docx', requests for reports/memos/letters, working with tracked changes or comments, or converting content into Word format. Do NOT use for PDFs, spreadsheets, or Google Docs.
```

> **주의**: `>-` 블록 스칼라 사용 금지. 파서가 `>-`를 지원하지 않으므로 description은 반드시 한 줄로 작성.

### Bad Example

```yaml
description: Handle documents
```

## Tools 등록 가이드

**`tools` 필드는 스킬의 권한 범위를 결정한다.** 선언하지 않은 도구는 오케스트레이터가 필터링할 수 있으므로, 스킬이 사용하는 모든 도구를 빠짐없이 등록해야 한다.

### 커스텀 도구 (MCP 파이프라인)

SoulFlow 파이프라인을 통해 실행되며, 채널에 결과가 전파된다.

| 도구명 | 용도 | 비고 |
|--------|------|------|
| `exec` | 샌드박스 셸 실행 (just-bash) | 토큰 절약용 — `ls`, `cat`, 간단한 파일 조작 |
| `read_file` | 파일 읽기 | |
| `write_file` | 파일 쓰기 | |
| `edit_file` | 파일 편집 | |
| `list_dir` | 디렉토리 목록 | |
| `web_search` | 웹 검색 | |
| `web_fetch` | 웹 페이지 가져오기 | |
| `web_browser` | 브라우저 자동화 | |
| `message` | 채널 메시지 전송 | |
| `send_file` | 파일 전송 | |
| `spawn` | 서브에이전트 생성 | |
| `cron` | 크론 스케줄 | |
| `memory` | 장기/일별 메모리 | |
| `http_request` | HTTP 요청 | |
| `oauth_fetch` | OAuth 인증 API 호출 | `oauth:` 선언 시 자동 추가 |
| `diagram_render` | Mermaid 다이어그램 | |
| `secret` | 시크릿 관리 | |

### SDK 네이티브 도구

Claude SDK가 직접 제공하는 도구. 시스템 수준 접근이 필요할 때 사용.

| 도구명 | 용도 | 언제 사용? |
|--------|------|-----------|
| `Bash` | 시스템 셸 실행 | `python`, `node`, `curl`, `git` 등 시스템 바이너리 실행 필요 시 |
| `Read` | 파일 읽기 (SDK 네이티브) | 대용량 파일, 바이너리 파일 |
| `Write` | 파일 쓰기 (SDK 네이티브) | |
| `Edit` | 파일 편집 (SDK 네이티브) | |

### exec vs Bash 선택 기준

| 상황 | 도구 | 이유 |
|------|------|------|
| `ls`, `cat`, `wc` 같은 파일 탐색 | `exec` | just-bash 샌드박스에서 토큰 절약 |
| `python script.py` 실행 | `Bash` | 시스템 바이너리 접근 필요 |
| `curl`로 API 호출 | `Bash` | 네트워크 접근 필요 |
| `docker run ...` 컨테이너 실행 | `Bash` | 시스템 데몬 접근 필요 |
| `git commit`, `gh pr create` | `Bash` | git/gh CLI 필요 |

### 예시

```yaml
# 파일 탐색만 하는 스킬
tools: [exec]

# Python 스크립트 실행이 필요한 스킬
tools: [exec, Bash]

# 웹 검색 + 파일 생성
tools: [web_search, web_fetch, write_file]

# 시스템 명령 + 파일 조작 + 전송
tools: [exec, Bash, write_file, send_file]
```

## Model 선택 기준

| 기준 | `local` | `remote` |
|------|---------|----------|
| 도구 호출 패턴 | 단순 매핑 (1 input → 1 tool call) | 다단계 추론 필요 |
| 스크립트 존재 | scripts/ 있고 --help로 실행 가능 | 에이전트가 코드 생성 필요 |
| 컨텍스트 의존성 | 낮음 (정형화된 워크플로우) | 높음 (사용자 의도 해석 필요) |
| 응답 시간 | 즉시 응답 기대 | 복잡한 작업 허용 |
