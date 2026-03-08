# Persona Message Renderer Design

> Status: Design retained · English maintenance mirror  
> Canonical source: `docs/PERSONA_MESSAGE_RENDERER_DESIGN.md`

## Purpose

This document summarizes the design goal of making all user-facing messages follow
the same persona rules and the same tone/manner policy.

Two core requirements drive the design:

- outputs must be normalized against persona rules
- final wording must be generated dynamically based on the user’s requested tone and manner

In short, identity should be deterministic, while expression should stay dynamic.

## Core Judgment

The system currently has two kinds of user-facing text:

1. free-form LLM responses
2. deterministic messages produced directly by channels, orchestration, or workflows

If these remain separate, the same problems keep recurring:

- some replies reflect persona and tone correctly
- some sound like raw system messages
- some leak internal model identity or product wording

The direction is therefore simple:

`Route all user-facing messages through PersonaMessageRenderer.`

## Target State

### 1. Separate meaning from expression

The system should first normalize “what should be said” into an intent.
Then the renderer should produce the final sentence from the current persona/tone state.

Example intents:

- `identity`
- `safe_fallback`
- `error`
- `status_started`
- `status_progress`
- `status_completed`
- `workflow_resume_notice`
- `approval_processed`
- `expired_task_notice`
- `inquiry_summary`

### 2. Tone and manner must be dynamic

Final phrasing should be able to change based on:

- identity from `SOUL.md`
- default tone from `HEART.md`
- role skill `heart`
- stored preferences from `USER.md` or memory
- explicit user requests in the current turn

Examples:

- “Talk casually”
- “Be warmer”
- “Keep it short and businesslike”

### 3. Strange concepts are valid surface styles

Simple tone sliders are not enough.
The renderer should support stronger surface concepts such as:

- noir detective
- medieval butler
- cyberpunk guide
- fantasy protagonist
- Cthulhu-like narrator
- cosmic observer
- chunibyo-style character

Important constraint:

- identity does not change
- facts, safety, policy, and tool contracts do not change
- only the surface style changes: wording, rhythm, imagery, and framing

### 4. Hard-coded messages must also go through the renderer

This includes:

- identity short-circuit replies
- channel status messages
- error messages
- task/workflow resume notices
- command reply wrappers
- approval notices
- expired task notices

### 5. Sanitizer stays as the final guard

`output-sanitizer` is still needed, but only as a leak guard:

- remove model-name leakage, internal meta, or tool protocol leakage
- clean HTML/noise

It should not be the primary place where tone or persona is created.

## Architecture Summary

### Meaning normalization layer

Channels, orchestration, and workflows should first produce a structured intent.

### PersonaMessageRenderer

The renderer takes:

- intent
- persona identity
- tone state
- role heart
- current-turn override
- persistent preference
- optional concept pack / ad-hoc concept

and produces the final user-facing text.

### Policy priority

Recommended priority order:

1. safety / policy constraints
2. identity constraints
3. current-turn override
4. persistent user preference
5. role heart / default heart
6. default fallback tone

## Current Product Policy Notes

The current intended policy is:

- deterministic/system messages may directly apply registered concept packs
- ad-hoc concepts may be parsed and preserved, but are not automatically allowed to rewrite deterministic system messages
- `command_reply` must pass through the renderer, but the command body itself should not be rewritten

These are product decisions, not bugs.

## Completion Criteria

The design is considered fully reflected in implementation when:

- all deterministic user-facing messages pass through the renderer
- identity short-circuiting happens before backend free-form generation
- the renderer reflects stored tone preferences and current-turn tone overrides
- the sanitizer is reduced to a final leak guard
- concept-style roleplay changes only the surface style, not core identity or policy behavior

## Maintenance Rules

- keep persona source-of-truth in templates and policy, not in regex filters
- renderer owns expression; classifier/gateway/orchestrator own meaning
- when a new deterministic message is added, add a renderer intent first
- widen ad-hoc concept support only after safety and policy boundaries are fixed
