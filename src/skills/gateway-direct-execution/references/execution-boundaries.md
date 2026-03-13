# Execution Boundaries

## Gateway가 가져갈 것

- 요청 분류
- direct path 가능 여부 판단
- provider / executor 선택
- fallback 체인 계산
- model-direct 가능 여부 판단

## Orchestration에 남길 것

- workflow / phase execution
- task loop
- process tracking
- HITL / waiting state
- finalize / audit / events

## 금지

- gateway를 새 오케스트레이터로 만들지 않는다
- workflow state machine을 gateway로 옮기지 않는다
