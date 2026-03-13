# Compiler Boundary Reference

## Keep Separate
- `RolePolicyResolver`
- `ProtocolResolver`
- `PromptProfileCompiler`
- `PersonaMessageRenderer`

## Intended Responsibilities
- resolver: load and normalize role assets
- protocol resolver: expand shared protocol references
- profile compiler: combine role baseline with persona/task/user overrides
- renderer: produce deterministic channel text, not system prompts
