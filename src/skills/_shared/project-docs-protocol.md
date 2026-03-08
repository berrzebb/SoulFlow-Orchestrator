# 프로젝트 문서 프로토콜

## 칸반 보드 = 단일 원천 (Single Source of Truth)

| 문서 | 저장 위치 | 작성 역할 |
|------|----------|----------|
| **계획서** | Board description | PM (설계자) |
| **맥락 노트** | Card description | PL (분배자) |
| **체크리스트** | Card subtasks + comments | Reviewer + Validator |

## 역할 체인

```
PM (설계자)
  → 칸반 보드 생성: kanban("create_board", board_name, description=계획서)
  → 계획서 작성: 목표, 범위, 완료 기준, 역할 배정

PL (분배자)
  → 전체 카드를 todo로 등록: kanban("create_card") × N
  → 적당량만 in_progress로 이동 (의존성/복잡도/WIP 제한 고려)
  → 각 카드에 맥락 노트 첨부 (담당자 지침)

Implementer (구현자)
  → 작업 수행
  → 완료 시: kanban("move_card", card_id, "in_review")

Reviewer (리뷰어)
  → 코드 리뷰 체크리스트 실행
  → 통과: kanban("move_card", card_id, "done")
  → 반환: kanban("move_card", card_id, "todo") + 피드백 comment

Validator (검증자)
  → 빌드/테스트/lint 자동 체크
  → 오류 적음: 즉시 수정 → 재검증 → done
  → 오류 많음: Implementer에게 반환 (오류 목록 + 수정 방향)
```

## 작업 분배 원칙

- PL은 전체 카드를 todo에 등록 후 **적당량만** in_progress로 이동
- WIP 제한: 동시 in_progress 카드는 팀 규모의 2배 이하
- 의존성이 있는 카드는 선행 카드 완료 후 이동
- 복잡도가 높은 카드는 분해하여 등록

## 구조화된 보고서 형식

모든 에이전트 피드백에는 3요소 포함:
1. **무엇을 발견했는지** — 현상/문제 기술
2. **무엇을 수정했는지** — 변경 사항 구체 기술
3. **왜 그렇게 판단했는지** — 근거/기준/맥락
