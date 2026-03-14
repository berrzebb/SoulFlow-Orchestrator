# Memory System

SoulFlow agents retain memory across sessions. All memory is stored in SQLite (`memory/memory.db`).

## Memory Types

| Type | Path | Purpose | Lifetime |
|------|------|---------|----------|
| Long-term | `sqlite://memory/longterm` | Verified patterns, preferences, decisions | Permanent |
| Daily | `sqlite://memory/daily/YYYY-MM-DD` | Today's work log, in-progress context | Per day |

## How Agents Access Memory

Agents use the `memory` tool to read and write memory.

```
action=read_longterm       → read entire long-term memory
action=write_longterm      → overwrite long-term memory
action=read_daily          → read today's (or specified) daily memory
action=append_daily        → append content to today's memory
action=list_daily          → list memory by date
action=search              → keyword search across past memory
```

### Memory Recording Flow

```
New fact discovered
  → append_daily (immediate)         ← save to daily memory now
  → verify through repeated exposure
  → write_longterm (after validation) ← promote to long-term
```

## Slash Commands

```
/memory status                 → memory status summary
/memory list                   → daily memory index
/memory today                  → today's memory content
/memory longterm               → full long-term memory
/memory search <query>         → keyword search
```

## Hybrid Search

The memory system supports hybrid search combining multiple retrieval strategies:

| Strategy | Technology | Strength |
|----------|-----------|----------|
| **Keyword (FTS5/BM25)** | SQLite FTS5 full-text index with BM25 ranking | Exact term matching, fast |
| **Semantic (sqlite-vec)** | Native KNN vector search | Meaning-based similarity |

When an embedding model is available (Ollama or external), memory entries are automatically chunked and vectorized. Search results are merged using **Reciprocal Rank Fusion (RRF)** with temporal decay and **MMR (Maximal Marginal Relevance)** reranking to balance relevance and diversity.

Without an embedding model, search falls back to FTS5 keyword matching only.

### Tokenization Infrastructure

The hybrid search pipeline uses a shared tokenization layer for consistent query processing:

| Component | Role |
|-----------|------|
| **TokenizerPolicy** | Pluggable multi-language tokenization strategy — selects language-specific rules at runtime |
| **QueryNormalizer** | Normalizes queries before FTS5/BM25 indexing (lowercasing, punctuation removal, CJK segmentation) |
| **LexicalProfile** | BM25 parameter tuning per content type (long-form memories vs. short snippets) |
| **LanguageRuleLike** | Contract that language-specific rules implement (Korean/CJK word splitting, Latin stopword removal) |

The tokenizer policy is applied consistently at both **write time** (when storing memories) and **read time** (when searching), ensuring FTS5 index terms match query terms exactly.

### Session Novelty Gate

To avoid surfacing already-seen content, the retrieval pipeline includes a session novelty gate:

- Tracks document IDs retrieved during the current session
- Filters out previously returned results from subsequent searches
- Ensures agents receive fresh context rather than repeated information

## Memory Consolidation

During long sessions, older conversation history is automatically compressed — only important information is preserved in long-term memory.

During consolidation the agent:
1. Analyzes recent N messages
2. Extracts key patterns, decisions, and user preferences
3. Updates long-term memory via `memory_update`
4. Adds a summary to daily memory via `history_entry`

### Configuration

Configure via dashboard → **Settings** → `memory.consolidation`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable automatic consolidation |
| `trigger` | `idle` | Trigger mode: `idle` (after session inactivity) or `cron` (periodic) |
| `idleAfterMs` | 1800000 | Idle trigger: wait time after last activity (ms) |
| `intervalMs` | 86400000 | Cron trigger: consolidation interval (ms, default 24h) |
| `windowDays` | 7 | Number of daily memory days to analyze |
| `archiveUsed` | `false` | Delete consumed daily entries after consolidation |

### Daily Memory Injection

Recent daily memory can be automatically injected into the system prompt:

| Setting | Default | Description |
|---------|---------|-------------|
| `dailyInjectionDays` | `3` | Number of recent days to inject (0 = disabled) |
| `dailyInjectionMaxChars` | `4000` | Maximum characters to inject |

## Sensitive Data Handling

Sensitive information is automatically masked before being written to memory. Actual tokens/passwords are never recorded in memory.

→ API keys and tokens are stored separately in the [Security Vault](./security.md)

## Related Docs

→ [Security Vault](./security.md)
→ [Slash Command Reference](../guide/slash-commands.md)
