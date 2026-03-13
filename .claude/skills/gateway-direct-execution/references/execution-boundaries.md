# Execution Boundary Reference

## Gateway Owns
- request classification
- execution mode selection
- provider / executor policy
- fallback chain selection
- direct path eligibility

## Orchestration Owns
- process tracking
- workflow / phase execution
- HITL and waiting state
- finalize / event recording
- long-running task state

## Do Not Collapse
- Do not turn the gateway into a new orchestration service
- Do not move task loops, phase loops, or workflow state machines into the gateway
