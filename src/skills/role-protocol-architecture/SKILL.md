---
name: role-protocol-architecture
description: Role protocol architecture 설계/구현 전문. `src/skills/roles/*/SKILL.md`를 source of truth로 유지하면서 `RolePolicyResolver`, `ProtocolResolver`, `PromptProfileCompiler`로 역할 정책을 구조화한다. Use when 역할 기준을 런타임·워크플로우 생성기·에이전트 생성 UI가 공통으로 사용해야 할 때, `shared_protocols`를 실제 정책으로 해석해야 할 때, role baseline과 persona/task override를 분리해야 할 때. Do NOT use for 단순 문자열 prompt 조합, 한 역할의 문구만 수정하는 작업, user-facing deterministic renderer만 수정하는 작업.
metadata:
  model: remote
  tools:
    - read_file
    - write_file
    - edit_file
    - workflow
    - message
  triggers:
    - 역할 프로토콜
    - role policy
    - role protocol
    - prompt profile
    - protocol resolver
    - role policy resolver
    - prompt profile compiler
    - shared protocols
  soul: 역할 정책은 `src/skills/roles`에만 정의하고, 다른 경로에서는 해석하고 조합만 한다.
  heart: role baseline, persona baseline, task/workflow policy, user override를 분리하여 같은 기준점이 UI와 런타임에 공통 적용되게 한다.
  shared_protocols:
    - clarification-protocol
    - spp-deliberation
    - phase-gates
    - project-docs-protocol
  checks:
    - src/skills/roles가 실제 source of truth로 유지되나요?
    - 새 정책이 다른 파일에 중복 정의되지 않나요?
    - role baseline과 user/persona override가 분리되나요?
    - workflow generator와 runtime이 같은 baseline을 쓰나요?
---

# Role Protocol Architecture

## Quick Reference

| Task | Focus |
|------|-------|
| role metadata 정규화 | `RolePolicyResolver` |
| shared protocol 해석 | `ProtocolResolver` |
| baseline + override 합성 | `PromptProfileCompiler` |
| workflow generator 정렬 | tool-first workflow compiler baseline |
| UI 정렬 | raw prompt editor 대신 profile editor |

## 핵심 원칙

1. `src/skills/roles/*/SKILL.md`가 role policy의 source of truth다
2. 새 계층은 정책을 “정의”하지 않고 “해석”한다
3. role baseline 위에 persona/task/user override를 얹는다
4. `PersonaMessageRenderer`는 deterministic user-facing text 전용으로 유지한다

## 언제 이 스킬을 써야 하나

- role skill 메타를 구조화할 때
- shared protocol을 실제 런타임 정책으로 연결할 때
- workflow generator가 role baseline을 재사용하게 만들 때
- agent-definition UI를 raw prompt editor에서 profile editor로 바꿀 때

## 하지 말아야 할 것

- role baseline을 다른 디렉터리에 복사/재정의하지 않는다
- workflow generator 전용 새 role 정책을 따로 만들지 않는다
- user-facing renderer와 system prompt builder를 섞지 않는다

## References

- [role-policy-model.md](references/role-policy-model.md)
- [compiler-boundaries.md](references/compiler-boundaries.md)
- [workflow-compiler-rules.md](references/workflow-compiler-rules.md)
