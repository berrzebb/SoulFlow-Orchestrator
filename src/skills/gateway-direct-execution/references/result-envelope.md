# ResultEnvelope

모든 direct/model/workflow 경로는 공통 결과 계약을 사용한다.

최소 필드:

- `kind`
- `status`
- `summary`
- `body?`
- `structured?`
- `artifacts?`
- `audit?`

원칙:

- 사용자-facing 결과는 `summary/body`
- 시스템 후처리는 `structured`
- raw provider output은 직접 사용자에게 노출하지 않음
- 응답은 반드시 planner가 고정한 요청 채널로 전달
