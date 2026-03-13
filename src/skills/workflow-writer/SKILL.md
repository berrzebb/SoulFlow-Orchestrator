---
name: workflow-writer
description: 워크플로우 설계 전문. 프로바이더/백엔드 구성, 에이전트 프롬프트 작성, 노드 할당, 실시간 반복 수정까지 end-to-end 워크플로우 생성·편집. Use when 사용자가 자동화 워크플로우를 만들거나 수정하려 할 때, 멀티에이전트 파이프라인을 구성할 때, closed-loop 품질 게이트가 필요할 때, 기존 워크플로우에 단계를 추가/변경/삭제할 때. Do NOT use for 단순 워크플로우 실행(이미 정의가 있으면 바로 run).
metadata:
  model: remote
  tools:
    - workflow
    - read_file
    - message
  triggers:
    - 워크플로우 만들기
    - 워크플로우 생성
    - 워크플로우 수정
    - 워크플로우 편집
    - 자동화 만들기
    - 에이전트 파이프라인
    - create workflow
    - build workflow
    - edit workflow
  soul: 항상 초안을 먼저 만들고 시각화해서 보여준 후 피드백을 받아 수정한다. 절대 사용자 확인 없이 최종 확정하지 않는다.
  heart: 반드시 사용 가능한 백엔드와 노드를 먼저 조회한 후 설계한다. 역할 system_prompt 작성 시 src/skills/roles/ SKILL.md의 soul/heart를 참조한다.
  shared_protocols:
    - clarification-protocol
    - spp-deliberation
---

# Workflow Writer

워크플로우 설계 end-to-end: 요구사항 수집 → 초안 생성 → 시각화 + 피드백 루프 → 수정 → 최종 확정.

## 파일 구조

`create`/`update` 호출 시 `workspace/workflows/<slug>.yaml`에 자동 저장된다.
직접 쓰기 불필요. `read_file`로 현재 YAML을 읽어 구조 확인만 하면 된다.

```
workflow action=create name="<이름>" definition={...}   # YAML 자동 생성
workflow action=export name="<slug>"                    # YAML 텍스트 확인
read_file "workspace/workflows/<slug>.yaml"             # 파일 직접 확인
workflow action=get name="<slug>"                       # 파싱된 정의 확인
workflow action=update name="<slug>" definition={...}   # 수정 (YAML 자동 갱신)
workflow action=flowchart name="<slug>"                 # 구조 시각화
```

## 두 가지 진입 모드

| 모드 | 조건 | 시작 |
|------|------|------|
| **신규 생성** | 워크플로우 없음 | 1단계부터 |
| **실시간 수정** | 기존 slug 언급, "수정해줘" | get → flowchart → 변경 논의 → update |

---

## 신규 생성 절차

### 1단계 — 요구사항 수집

| 항목 | 질문 |
|------|------|
| **목표** | 최종적으로 무엇을 만들어야 하는가? |
| **입력** | 받는 입력은 무엇인가? (사용자 메시지, 파일, 스케줄 등) |
| **출력** | 결과를 어디에 전달하는가? (채널 메시지, 파일, API 등) |
| **품질 기준** | 결과가 "좋다"고 판단하는 기준은? → closed-loop 필요 여부 결정 |
| **트리거** | 언제 실행되는가? (수동, 스케줄, 웹훅, 채널 메시지 등) |

HIGH 모호성(되돌리기 어려운 구조 선택)은 진행 전 사용자 확인 필수.

### 2단계 — 환경 조회

```
workflow action=models       # 사용 가능한 backend ID + model ID 확인
workflow action=node_types   # 노드 타입 카탈로그 (DAG Style B 사용 시)
```

반드시 실제 조회 결과 사용. backend 이름·model ID 추측 금지.

### 3단계 — 구조 선택 + 설계

패턴 상세: [references/workflow-patterns.md](references/workflow-patterns.md)
에이전트 역할 및 system_prompt 작성: [references/prompt-patterns.md](references/prompt-patterns.md)

| 조건 | Style |
|------|-------|
| 멀티에이전트 + 품질 게이트 + closed-loop | **A (phases)** |
| 분기·데이터 변환·HTTP·복잡한 제어 흐름 | **B (DAG orche_nodes)** |
| 단순 순차 + 에이전트 협업 | **A (phases)** |

closed-loop 기본값은 `Bounded Closeout Loop`, 병렬 에이전트 수렴 기본값은 `Parallel + Critic Convergence`로 시작한다.

2개 이상의 구조가 가능하면 [spp-deliberation](../_shared/spp-deliberation.md) 실행.

### 4단계 — 생성 전 검증

- [ ] 모든 phase에 `phase_id`가 있는가?
- [ ] 모든 phase의 `agents[]`가 비어 있지 않은가?
- [ ] `backend` 값이 실제 조회한 backend ID와 일치하는가?
- [ ] closed-loop 시: `goto_phase`가 실제 존재하는 `phase_id`인가?
- [ ] closed-loop 시: 비평 phase가 `goto_phase`보다 뒤에 오는가?

### 5단계 — 초안 생성 + 시각화

```
# 1. 초안 생성 (YAML 자동 저장됨)
workflow action=create name="<이름>" definition={...}

# 2. 즉시 flowchart 시각화
workflow action=flowchart name="<slug>"

# 3. 사용자 피드백 요청
"위 구조를 확인해 주세요. 수정이 필요한 부분이 있으면 말씀해 주세요."
```

---

## 실시간 수정 루프

```
# 1. 현재 상태 확인
workflow action=get name="<slug>"
workflow action=flowchart name="<slug>"

# 2. 변경사항 논의 (범위 크면 spp-deliberation 적용)

# 3. 수정 적용 (YAML 자동 갱신됨)
workflow action=update name="<slug>" definition={...전체 definition...}

# 4. 수정 결과 시각화
workflow action=flowchart name="<slug>"

# 5. 추가 수정 필요하면 1로 돌아감
```

사용자가 "완료" 또는 "실행해봐"라고 할 때까지 루프 유지.

---

## 최종 확정 보고

```
**워크플로우**: <slug>  (workspace/workflows/<slug>.yaml)
**구조**: <phase 수 또는 노드 수>
**트리거**: <트리거 유형>
**closed-loop**: 있음(goto: <draft_phase> → max <N>회) / 없음
**실행**: workflow action=run name="<slug>"
```
