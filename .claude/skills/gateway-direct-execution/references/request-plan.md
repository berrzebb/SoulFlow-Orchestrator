# Request Plan Reference

Use a normalized execution plan rather than a thin mode enum.

Recommended plan kinds:
- `builtin`
- `direct_tool`
- `model_direct`
- `workflow_compile`
- `workflow_run`
- `agent_required`

Each plan should carry:
- normalized request context
- reply channel reference
- execution target information
- policy hints needed by the executor

The planner should decide. The executor should execute.
