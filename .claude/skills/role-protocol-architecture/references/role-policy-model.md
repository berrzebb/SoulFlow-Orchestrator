# Role Policy Model Reference

Minimum fields to normalize from `src/skills/roles/*/SKILL.md`:
- `role_id`
- `soul`
- `heart`
- `tools`
- `shared_protocols`
- `preferred_model`
- `use_when`
- `not_use_for`
- resource refs:
  - execution protocol
  - checklist
  - error playbook

The resolver reads these assets. It does not redefine them.
