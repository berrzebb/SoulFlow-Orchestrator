# Compiler Boundaries

## 분리 대상

- `RolePolicyResolver`
- `ProtocolResolver`
- `PromptProfileCompiler`
- `PersonaMessageRenderer`

## 책임

- resolver: role asset 로드 + 정규화
- protocol resolver: `shared_protocols`를 실제 trait/asset으로 해석
- profile compiler: role baseline + persona/task/user override 합성
- renderer: deterministic user-facing text 생성

## 금지

- renderer가 system prompt를 직접 만들지 않는다
- compiler가 role policy source를 직접 소유하지 않는다
