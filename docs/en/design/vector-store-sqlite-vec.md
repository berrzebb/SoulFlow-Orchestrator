# sqlite-vec Vector Store Design

## Purpose

The `vector store` provides a shared local similarity-search foundation for subsystems that need embedding-based retrieval.
Its goal is to avoid JavaScript-side brute-force scans and instead provide **local native KNN search inside SQLite**.

The core intent is:

- execute vector lookup inside the local database
- separate metadata storage from vector storage
- standardize normalized-vector handling and distance interpretation
- expose only the bounded operations needed by retrieval layers

## Position in the Stack

The vector store sits below retrieval policy and above the database implementation.

```text
retrieval or search service
  -> vector-store service
  -> SQLite + sqlite-vec
```

So this is not a product feature by itself.
It is shared infrastructure for memory, references, eval paths, and future retrieval components.

## Basic Structure

Each collection is modeled as two layers:

- metadata table
  - id, document, metadata, and related fields
- vec table
  - the actual embedding vectors

This separation exists so that:

- human-readable fields are not mixed with vector storage representation
- metadata lookups and KNN lookups are linked explicitly
- collection lifecycle remains simple

## Vector Normalization

The design assumes normalized vectors.

Core rules:

- vectors are L2-normalized before storage
- query vectors are normalized before lookup
- distance comes from sqlite-vec’s native KNN search
- similarity interpretation is derived from normalized-vector distance behavior

This keeps cosine-style semantic comparison compatible with an L2-oriented local KNN engine.

## Operation Model

The vector store exposes only a minimal shared contract:

- `upsert`
- `query`
- `delete`

At the design level, this matters because the vector store is not a general document database.
It is a similarity-index service used by higher retrieval layers.

## Collection Model

The store must support separation by `store_id` and `collection`.

That means:

- unrelated features do not need to share one physical dataset
- one store can still host multiple collections
- different retrieval subsystems can maintain independent lifecycles

Collections usually imply fixed vector dimensions.
So dimensionality behaves like part of collection identity.

## Relationship to sqlite-vec

The current implementation uses sqlite-vec, but the top-level design is not “about one extension function.”

The higher-level concept is:

- local SQLite-backed vector storage
- native KNN
- metadata + vector separation
- graceful isolation when vector lookup is unavailable

So sqlite-vec is the current implementation choice, while the design concept is a local native vector index.

## Error Isolation and Graceful Degradation

Because the vector store sits inside retrieval paths, failure here must not collapse the entire system.

The design must tolerate:

- sqlite-vec load failures
- uninitialized collections
- dimension mismatches
- per-query execution errors

In those situations, higher retrieval layers should still be able to fall back to lexical-only behavior or return empty results safely.

The vector store improves retrieval quality, but it should not become a hard availability dependency for the whole product.

## Relation to Retrieval Policy

The vector store does not define ranking policy.

Higher layers decide:

- whether lexical candidates are built first
- whether semantic-only retrieval is allowed
- which fusion policy is used
- how freshness is managed

The vector store is responsible only for semantic nearest-neighbor lookup.

## Boundaries

This design does not:

- generate embeddings itself
- define tokenization, lexical retrieval, or RRF fusion
- classify query intent or novelty
- build user-facing responses

`vector-store-sqlite-vec` is the storage-layer design beneath retrieval, not the full retrieval-policy design.

## Meaning in This Project

This project is local-first, so vector retrieval is also expected to run locally rather than through a hosted vector database.
This document fixes the adopted design:

- SQLite is the base store
- sqlite-vec provides native KNN
- metadata and vectors are stored separately
- similarity is interpreted through normalized-vector rules
- failures must be isolatable by higher retrieval layers

## Non-Goals

- solving every retrieval problem through the vector store alone
- putting full retrieval-policy logic into this document
- recording implementation status here
- managing embedding-provider rollout or migration sequencing here

This document describes the adopted vector-store design.
Detailed implementation planning and work breakdown belong in `docs/*/design/improved/*`.
