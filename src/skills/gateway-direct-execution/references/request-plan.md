# RequestPlan

권장 분류:

- `builtin`
- `direct_tool`
- `model_direct`
- `workflow_compile`
- `workflow_run`
- `agent_required`

최소 필드:

- normalized request
- reply channel reference
- execution policy hints
- chosen execution kind

핵심:

- planner가 실행 계획을 만든다
- executor는 계획을 수행한다
- raw mode enum 하나로 모든 경로를 표현하지 않는다
