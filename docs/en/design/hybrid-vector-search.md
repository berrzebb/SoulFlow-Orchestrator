# Hybrid Vector Search Design

## Purpose

`hybrid vector search` is the retrieval design used to complement keyword matching with semantic similarity when lexical search alone is not enough.
Its goal is not to send every query through a vector path, but to keep lexical search as the default and add semantic retrieval only when it helps.

The core intent is:

- resolve simple requests quickly with lexical search alone
- recover meaning-equivalent requests even when wording differs
- pay embedding cost at retrieval time, not on every write
- keep the system operational even when embeddings are unavailable

## Core Principles

The project uses the following principles for hybrid retrieval:

- lexical retrieval builds the primary candidate set
- semantic retrieval acts as a supplement, not the default path
- indexing and runtime selection are separate concerns
- embedding freshness is tracked by `content_hash`
- when embeddings are unavailable, the system degrades to lexical-only

This is a lexical-first architecture with semantic supplementation.

## Scope

This design is a shared concept across:

- tool selection
- memory retrieval
- reference-oriented retrieval
- future novelty-gate and session-reuse dedupe paths

Each subsystem may use different ranking details, but the retrieval philosophy is the same.

## Retrieval Shape

```text
Query
  -> normalize / tokenize
  -> lexical retrieval
  -> candidate sufficiency check
  -> semantic supplement (optional)
  -> merged ranked results
```

The important point is that the semantic path is not always open.
If lexical retrieval is already sufficient, the request ends there.

## Lexical-First Layer

The first-stage retriever is lexical.

In the current project, that layer includes:

- FTS-backed storage
- an in-memory lexical mirror
- category and tag fallbacks
- query normalization and Korean keyword expansion

This keeps the system useful even without vector retrieval.
Semantic retrieval improves recall, but it does not define the baseline behavior.

## Semantic Supplement Layer

Semantic retrieval only runs for items that have embeddings or can be embedded on demand.

The intended flow is:

1. a query arrives
2. lexical retrieval runs first
3. the system checks whether lexical results are sufficient
4. only then does it inspect embeddings
5. stale or missing embeddings are created lazily
6. vector similarity fills remaining slots

This design exists to reduce both cost and latency.
The system does not call an external embedding API on every tool build or memory write.

## Lazy Embeddings and Content Hash

Embedding freshness is tracked through `content_hash`, not through timestamps alone.

- writes may store the document and its `content_hash`
- retrieval regenerates embeddings only when they are missing or stale
- unchanged content should not be embedded again

This reduces:

- write-path API cost
- unnecessary re-embedding of unchanged content

## Merge Policy

Lexical and semantic results are not blended as equal authorities.

The merge model is:

- preserve lexical order as the baseline
- use semantic results to fill open slots
- do not reinsert items that are already selected
- treat category/core fallback as part of the full selection policy

Semantic retrieval improves selection quality, but it does not replace the main ranking model.

## Graceful Degradation

The design does not assume that an embedding provider is always available.

The system must continue to function when:

- no embedding provider is configured
- sqlite-vec is disabled
- the embedding API fails temporarily
- freshness checks cannot complete for part of the corpus

In those cases the retrieval path falls back to lexical-only behavior.
The search quality may change, but the product should continue to work.

## Relation to Tool Selection

Tool selection uses a lexical-first candidate path, with semantic retrieval as optional supplementation.

That matters because tool selection is not a generic retrieval problem.
It is a bounded candidate-selection problem with token budget and explainability constraints.

The dedicated tool-selection policy is documented separately in `tool-selection-fts5`.
This document defines the shared retrieval philosophy beneath it.

## Relation to Memory Search

Memory retrieval benefits more from semantic supplementation because it deals with longer documents and narrative content.
Still, the same rules apply:

- lexical first
- lazy embeddings
- `content_hash` freshness
- semantic supplementation instead of semantic replacement

Future novelty-gate and reuse-evidence paths should share the same tokenizer and normalization policy.

## Boundaries

This design does not:

- decide whether a query is recall, retry, or new search
- define tool budgets or search budgets
- make final freshness decisions per request type
- generate user-facing answers

`hybrid vector search` is a retrieval-layer concept, not an orchestration-policy layer.

## Meaning in This Project

This project is a local-first orchestrator, so retrieval cannot depend exclusively on high-cost vector paths.
The design therefore fixes these ideas:

- use a fast lexical baseline
- add semantic retrieval only when it helps
- track freshness through `content_hash`
- prefer graceful degradation over hard failure

## Non-Goals

- locking the project to a single provider or embedding model as the source of truth
- making every search semantic-first
- storing rollout or completion state in this document
- managing detailed work items for tool selection, memory retrieval, or novelty-gate expansion

This document describes the adopted retrieval design.
Detailed tokenizer integration, retrieval expansion, and rollout work belong in `docs/*/design/improved/*`.
