# Gateway Direct Execution Skill
Implement or refactor the `channel -> normalize -> classify -> plan -> execute` path.

## Use When
- Request classification needs to distinguish `builtin`, `direct_tool`, `model_direct`, `workflow_compile`, `workflow_run`, and `agent_required`
- `GatewayDecision` needs to become a richer `RequestPlan`
- Provider/executor decision logic needs to move toward an `ExecutionGateway`
- Direct tool or model-direct execution should reply through the original requested channel
- Result formatting should be standardized with a `ResultEnvelope`

## Rules
1. Keep **gateway = decision** and **orchestration = execution**
2. Prefer `direct_tool` / `model_direct` before `agent_required`
3. Preserve requested channel affinity end-to-end
4. Return structured `ResultEnvelope` results instead of raw free-form provider output
5. Do not move task loop / phase loop state machines into the gateway

## Workflow
1. Read `references/request-plan.md`
2. Read `references/execution-boundaries.md`
3. Identify which part is being changed:
   - classification
   - planning
   - execution gateway
   - direct executor
   - result envelope / channel affinity
4. Make the smallest change that improves the boundary without re-coupling provider logic into orchestration
5. Add or update focused tests for the specific path being changed

## Deliverables
- Clear boundary between request planning and execution
- Deterministic result envelope for direct/model/workflow paths
- Tests that lock the changed path
