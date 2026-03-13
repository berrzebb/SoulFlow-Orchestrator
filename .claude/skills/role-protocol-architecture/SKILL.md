# Role Protocol Architecture Skill
Implement or refactor role policy handling so `src/skills/roles/*/SKILL.md` remains the source of truth.

## Use When
- Role policy needs to be normalized into a reusable object model
- `shared_protocols` or role resources need structured resolution
- A prompt/profile path currently hardcodes role behavior outside `src/skills/roles`
- Workflow generation or UI editing needs to reuse the same role baseline as runtime

## Rules
1. Treat `src/skills/roles/*/SKILL.md` as the policy source of truth
2. Add interpreters/resolvers, not duplicate policy definitions
3. Keep `PersonaMessageRenderer` for deterministic user-facing text only
4. Separate:
   - role baseline
   - persona baseline
   - task/workflow policy
   - user override
5. Prefer structured `RolePolicy` / `PromptProfile` objects over raw string assembly

## Workflow
1. Read `references/role-policy-model.md`
2. Read `references/compiler-boundaries.md`
3. Locate the current string assembly path
4. Replace it with resolver/compiler usage without changing source-of-truth ownership
5. Add tests that verify the same role baseline is used across runtime, workflow generation, or UI paths

## Deliverables
- Resolver/compiler layer that interprets role assets
- No new duplicated policy baseline outside `src/skills/roles`
- Snapshot or contract tests for the changed role path
