# 스킬 시스템

스킬은 에이전트의 확장 기능입니다. `workspace/skills/` 디렉터리에 위치하며, 에이전트가 특정 도메인에서 더 정확하게 동작하도록 컨텍스트와 도구를 추가합니다.

## 구조

각 스킬은 2계층으로 구성됩니다.

```
workspace/skills/
  web-search/
    SKILL.md          ← 핵심 설명 + 라우팅 조건 (~800B, 항상 로드)
    references/       ← 실행 프로토콜, 예시, 세부 명세 (필요 시 로드)
  web-browsing/
    SKILL.md
  ppt-generator/
    SKILL.md
    references/
      ppt_style_guide.md
```

**Layer 1 (SKILL.md)**: 항상 에이전트 컨텍스트에 포함. 짧게 유지. 역할, 트리거 조건, 핵심 규칙만 기술.
**Layer 2 (references/)**: 에이전트가 필요할 때 로드. 세부 사양, 예시, 체크리스트 포함.

## 스킬 종류

| 종류 | 위치 | 특징 |
|------|------|------|
| **builtin** | 소스 코드 내부 | 역할 스킬 (butler · pm · pl · implementer 등) — 읽기 전용 |
| **workspace** | `workspace/skills/` | 사용자 정의 스킬 — 대시보드에서 추가/편집/삭제 가능 |

`workspace/skills/`의 모든 스킬은 사용자가 직접 추가하고 관리하는 커스텀 스킬입니다.

## 대시보드에서 스킬 편집

**Workspace → Skills 탭**에서 스킬 파일을 직접 편집할 수 있습니다.

1. 스킬 목록에서 workspace 스킬 선택 (builtin 스킬은 편집 불가)
2. 파일 탭에서 `SKILL.md` 또는 `references/` 파일 선택
3. 텍스트 에디터에서 내용 수정
4. **Save** 버튼 클릭 → 즉시 반영 (재시작 불필요)

> builtin 스킬은 소스 코드에 내장되어 있어 대시보드 편집이 불가합니다.

### 도구 피커 (SKILL.md 편집 시 자동 표시)

`SKILL.md`를 편집할 때 에디터 아래에 **도구 피커**가 자동으로 표시됩니다.

| 섹션 | 내용 |
|------|------|
| **도구:** | SoulFlow 레지스트리에 등록된 도구 (클릭으로 `tools:` 필드 토글) |
| **SDK:** | Bash · Read · Write · Edit · Glob · Grep 등 Claude Code 네이티브 도구 |
| **OAuth:** | 등록된 OAuth 서비스 (클릭으로 `oauth:` 필드 토글) |
| **역할 프리셋:** | 역할 버튼 클릭 → 해당 역할의 도구 세트를 일괄 병합 |

도구 피커는 SKILL.md 상단 frontmatter의 `tools:`, `oauth:` 필드를 직접 수정합니다:

```markdown
---
metadata:
  tools: [web_search, send_message, read_file]
  oauth: [github]
---
```

## 스킬 관리 커맨드

```
/skill list               → 사용 가능한 스킬 목록
/skill info <name>        → 스킬 상세 정보
/skill suggest            → 현재 요청에 적합한 스킬 추천
/reload skills            → 재시작 없이 스킬 핫 리로드
```

## 커스텀 스킬 만들기

1. `workspace/skills/<skill-name>/` 디렉터리 생성
2. `SKILL.md` 작성:

```markdown
# SKILL: <이름>

## 역할
이 스킬이 무엇을 하는지 한 줄 설명.

## 트리거 조건
어떤 요청에 이 스킬이 활성화되어야 하는지.

## 핵심 규칙
- 규칙 1
- 규칙 2

## 도구
사용할 도구 목록.
```

3. `/reload skills` 명령으로 즉시 적용 (재시작 불필요)

또는 **대시보드 → Workspace → Skills 탭**에서 직접 생성/편집할 수도 있습니다.

## 관련 문서

→ [에이전트 시스템](./agents.md)
→ [대시보드 사용법](../guide/dashboard.md)
→ [슬래시 커맨드 레퍼런스](../guide/slash-commands.md)
