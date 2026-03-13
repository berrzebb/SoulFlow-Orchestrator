---
name: gateway-direct-execution
description: Gateway direct execution 설계/구현 전문. 채널 요청을 `builtin`, `direct_tool`, `model_direct`, `workflow_compile`, `workflow_run`, `agent_required`로 분류하고, 가능한 경로는 에이전트 없이 직접 실행하도록 경계를 정리한다. Use when 게이트웨이/오케스트레이션 분리, direct tool path, model-direct path, RequestPlan, ExecutionGateway, ResultEnvelope, requested channel affinity 작업을 수행할 때. Do NOT use for phase loop 내부 구현, workflow state machine 자체 수정, 단순 프롬프트 문구 조정만 필요한 작업.
metadata:
  model: remote
  tools:
    - read_file
    - write_file
    - edit_file
    - workflow
    - message
  triggers:
    - 게이트웨이 직접 실행
    - direct tool path
    - model direct
    - execution gateway
    - request plan
    - result envelope
    - requested channel affinity
    - gateway direct execution
  soul: 가능한 요청은 가장 저렴하고 안전한 직접 실행 경로로 보내며, 에이전트는 마지막 fallback으로 남긴다.
  heart: direct/model/workflow 경로의 결과도 반드시 표준 envelope로 만들고, 사용자가 요청한 통로로 정확히 돌려준다.
  shared_protocols:
    - clarification-protocol
    - spp-deliberation
    - phase-gates
  checks:
    - gateway가 결정을 담당하고 orchestration이 실행을 담당하나요?
    - agent가 필요 없는 요청이 direct path로 내려가나요?
    - 결과가 ResultEnvelope로 표준화되나요?
    - 응답이 요청된 채널로 다시 귀속되나요?
---

# Gateway Direct Execution

## Quick Reference

| Task | Focus |
|------|-------|
| 요청 분류 확장 | `RequestPlan` 도입 |
| provider/executor 정책 분리 | `ExecutionGateway` 책임 이동 |
| 에이전트 없는 실행 경로 | `DirectExecutor` 도입 또는 확장 |
| 결과 형식 정리 | `ResultEnvelope` 표준화 |
| 응답 통로 보장 | requested channel affinity 유지 |

## 핵심 원칙

1. `gateway = decision`, `orchestration = execution`
2. `direct_tool` / `model_direct` / `workflow_run`은 가능한 한 agent loop 없이 처리
3. 결과는 자유 문자열이 아니라 표준 envelope로 반환
4. planner 단계에서 고정한 reply channel은 execution/finalize 단계에서 바꾸지 않는다

## 언제 이 스킬을 써야 하나

- gateway 경로를 확장할 때
- 요청 분류기를 손볼 때
- direct execution을 추가할 때
- 결과 포맷을 통일할 때
- channel affinity / callback 경로를 고정할 때

## 하지 말아야 할 것

- task loop, phase loop, workflow state machine을 gateway로 옮기지 않는다
- provider별 wire format 처리 로직을 gateway에 직접 넣지 않는다
- direct path 결과를 raw provider 문자열 그대로 사용자에게 노출하지 않는다

## References

- [request-plan.md](references/request-plan.md)
- [execution-boundaries.md](references/execution-boundaries.md)
- [result-envelope.md](references/result-envelope.md)
