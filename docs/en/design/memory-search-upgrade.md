# Memory Search Design

## Purpose

`memory search` is the retrieval layer used to find prior daily records and long-term memory inside the project.
Its goal is not just to store memory, but to make **short-lived daily notes and durable long-term documents searchable in one system while preserving both semantic relevance and recency**.

The core intent is:

- search memory at chunk granularity rather than whole-document granularity
- combine lexical and semantic retrieval while keeping lexical search as the baseline
- surface recent daily context more aggressively than stale history
- preserve durable memory before conversation compaction removes high-context turns

## Memory Model

The project uses two main memory classes:

- `daily`
  - day-oriented running notes and session-level history
- `longterm`
  - durable, structured, or evergreen memory

These two classes share one retrieval system, but they are not treated identically.

- `daily` is recency-sensitive
- `longterm` is relatively evergreen

## Separation of Storage and Retrieval

The source of truth is the document-level store.
Retrieval runs on derived search indexes built on top of it.

```text
memory document
  -> chunking
  -> lexical index
  -> optional vector index
  -> ranked retrieval
```

This separation exists so that:

- the storage format is not forced to equal the retrieval format
- chunk indexes remain rebuildable
- lexical retrieval still works even when embeddings are unavailable

## Chunk-Based Retrieval

Memory retrieval operates on chunks rather than full documents.

Chunking exists to:

- avoid averaging multiple topics into one embedding
- return the relevant section instead of an entire document
- support file/line/snippet style evidence in downstream systems

A chunk normally carries:

- source document key
- heading
- line range
- chunk content
- content hash
- creation or source timestamp

So the real retrieval unit is the `memory chunk`, not the raw memory document.

## Hybrid Retrieval

Memory search combines lexical and semantic retrieval.

The governing rules are:

- lexical retrieval builds the baseline candidate set
- semantic retrieval supplements when embeddings are available
- if embeddings are missing, retrieval degrades to lexical-only
- embedding freshness is checked through `content_hash`

This makes memory search a domain-specific application of the broader `hybrid-vector-search` design.

## Rank Fusion

Memory search should not simply union lexical and semantic hits.
It needs a stable merged ranking.

The top-level design uses this model:

- lexical and semantic results are treated as ranked lists
- the final result is produced through reciprocal-rank style fusion
- rank stability is preferred over brittle score normalization

This avoids forcing BM25 scores and vector distances into one artificial scale.

## Temporal Decay

Not every memory should have equal weight forever.

For `daily` memory especially, time decay is part of the retrieval design.

Why:

- yesterday’s work log is usually more relevant than a note from months ago
- recent context improves session continuity
- old records should remain searchable without dominating the top of the ranking

`longterm` memory is different.
At the design level, daily and long-term memory may follow different recency rules.

## Relation to Compaction Flush

Memory search is tied to the compaction path as well as the retrieval path.

Before conversation state is compacted, the system should be able to:

- promote durable information into memory
- later retrieve it through the same chunk-based search path

So memory search is part of a closed loop:
preserve -> index -> retrieve -> reuse.

## Result Shape

Memory search results are designed to return evidence, not just strings.

Typical fields include:

- source file or logical path
- line or line range
- snippet text
- optional score metadata

That structure is useful not only for answer synthesis, but also for novelty gates, session reuse, and audit paths.

## Boundaries

This design does not:

- decide what should be stored in memory in the first place
- define the entire session summarization policy
- generate user-facing responses
- make final reuse vs retry decisions for novelty gating

`memory search` is the retrieval design over memory, not the full conversation-policy layer.

## Meaning in This Project

The project treats memory as a searchable working-memory system, not a plain append-only log.
This document fixes the adopted design:

- documents are the source of truth
- retrieval runs at chunk level
- retrieval is hybrid
- recency affects ranking
- durable flush before compaction is part of the design

## Non-Goals

- forcing one embedding provider as the single source of truth
- collapsing all memory-saving behavior into one universal rule
- recording completion or rollout status here
- managing detailed scoring parameters or implementation sequence in this document

This document describes the adopted memory-search design.
Detailed work breakdown and rollout tasks belong in `docs/*/design/improved/*`.
