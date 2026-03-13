# RolePolicy Model

정규화 대상 최소 필드:

- `role_id`
- `soul`
- `heart`
- `tools`
- `shared_protocols`
- `preferred_model`
- `use_when`
- `not_use_for`
- resources:
  - `execution_protocol`
  - `checklist`
  - `error_playbook`

중요:

- resolver는 이 필드를 읽어 구조화한다
- resolver가 새 정책 값을 만들어내면 안 된다
