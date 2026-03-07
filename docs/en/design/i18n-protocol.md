# Design: Shared i18n Protocol — Unified Multilingual Infrastructure

> **Status**: Complete — all 5 phases implemented (infrastructure · automation · tool/node integration · rendering · cleanup)

## Overview

Replace the fragmented i18n system (3 separate sources, manual sync across 900+ keys) with a **single source of truth** JSON-based protocol shared by both frontend and backend, plus an automation tool that detects missing/orphan keys.

## Problem

Current i18n requires **editing 3+ files** for every new feature:

| Source | Format | Keys | Used by |
|--------|--------|------|---------|
| `web/src/i18n/en.ts` | TS Record | ~450 | Frontend UI |
| `web/src/i18n/ko.ts` | TS Record | ~450 | Frontend UI |
| `web/src/i18n/tool-descriptions.ts` | Separate TS | ~22 tools × 2 langs | Tools page |
| Backend Tool classes | Hardcoded `readonly description` | ~60 tools | LLM tool schema |
| Node descriptors | Hardcoded `toolbar_label`, schema descriptions | ~76 nodes | Workflow editor |

**Pain points:**
1. 3-file edit per feature → high friction, easy to miss
2. No missing-key detection → silent fallback to key string
3. Tool descriptions duplicated between FE i18n and BE hardcoded strings
4. Node descriptors have no i18n at all (English-only `toolbar_label`, `description`)
5. Adding a new language requires touching every file

## Architecture

### Single Source of Truth

```
src/i18n/
├── protocol.ts              ← Shared types + create_t() (FE & BE)
├── index.ts                 ← Backend entry (load JSON, export t)
└── locales/
    ├── en.json              ← All English translations (flat keys)
    └── ko.json              ← All Korean translations
    └── {locale}.json        ← Future: ja.json, zh.json, ...

web/src/i18n/
├── index.tsx                ← React provider (imports shared JSON + protocol)
└── (en.ts, ko.ts, tool-descriptions.ts → DELETED after migration)
```

### Key Namespace Convention

| Prefix | Domain | Example |
|--------|--------|---------|
| `common.*` | Shared UI strings | `common.save`, `common.cancel` |
| `nav.*` | Navigation | `nav.overview`, `nav.chat` |
| `workflows.*` | Workflow builder UI | `workflows.llm_backend`, `workflows.add_node` |
| `tool.{name}.desc` | Tool description | `tool.exec.desc` |
| `tool.{name}.param.{param}` | Tool param description | `tool.exec.param.command` |
| `node.{type}.label` | Node toolbar label | `node.git.label` |
| `node.{type}.desc` | Node description | `node.git.desc` |
| `node.{type}.input.{field}` | Node input field desc | `node.git.input.operation` |
| `node.{type}.output.{field}` | Node output field desc | `node.git.output.stdout` |
| `cat.{id}` | Node category label | `cat.flow`, `cat.ai` |

### Shared Protocol (`src/i18n/protocol.ts`)

```typescript
export type Locale = "en" | "ko";
export type TranslationDict = Record<string, string>;
export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function create_t(dict: TranslationDict, fallback?: TranslationDict): TFunction;
export function parse_locale(value: unknown): Locale;
```

### Backend Usage (`src/i18n/index.ts`)

```typescript
import en from "./locales/en.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };

const DICTS: Record<Locale, TranslationDict> = { en, ko };
let current_locale: Locale = "en";

export function set_locale(locale: Locale): void;
export function get_t(locale?: Locale): TFunction;
export function t(key: string, vars?): string;  // uses current_locale
```

Backend tools can then reference i18n keys:
```typescript
// Before: hardcoded
readonly description = "Execute a shell command and return stdout/stderr.";

// After: i18n key (resolved at schema generation time)
get description() { return t("tool.exec.desc"); }
```

### Frontend Usage (`web/src/i18n/index.tsx`)

```typescript
import en from "../../src/i18n/locales/en.json";
import ko from "../../src/i18n/locales/ko.json";
import { create_t, type Locale } from "../../src/i18n/protocol";

// React context provides locale switching + t() function
// Identical create_t() from shared protocol
```

### Node Descriptor i18n Integration

Node descriptors switch from hardcoded strings to i18n keys:

```typescript
// Before
export const git_descriptor = {
  toolbar_label: "+ Git",
  output_schema: [
    { name: "stdout", type: "string", description: "Command stdout" },
  ],
};

// After: toolbar_label uses i18n key, resolved at render time
// The descriptor stores the key; graph-editor calls t(key) when rendering
export const git_descriptor = {
  toolbar_label: "node.git.label",  // i18n key
  output_schema: [
    { name: "stdout", type: "string", description: "node.git.output.stdout" },
  ],
};
```

## Automation Tool (`scripts/i18n-sync.ts`)

### Capabilities

1. **Scan** — Extract all `t("key")` calls from FE/BE source
2. **Scan tools** — Extract tool names from `src/agent/tools/*.ts`
3. **Scan nodes** — Extract node types from `web/src/pages/workflows/nodes/*.tsx`
4. **Diff** — Compare scanned keys against `en.json` / `ko.json`
5. **Report** — Print missing keys, orphan keys, untranslated ko keys
6. **Generate** — Auto-create stubs for missing keys (EN value = key, KO = EN copy)

### Usage

```bash
# Report mode (default): show missing/orphan keys
npx tsx scripts/i18n-sync.ts

# Generate mode: add stubs for missing keys
npx tsx scripts/i18n-sync.ts --fix

# Check mode (CI): exit 1 if any missing keys found
npx tsx scripts/i18n-sync.ts --check
```

### Example Output

```
[i18n-sync] Scanning sources...
  Found 588 t() calls across 80 files
  Found 60 backend tools
  Found 76 frontend nodes

[i18n-sync] Checking en.json...
  ✓ 1,200 keys defined
  ✗ 15 missing keys:
    - node.docker.label
    - node.docker.desc
    - tool.web_auth.desc
    ...
  ⚠ 3 orphan keys (defined but unused):
    - workflows.old_feature
    ...

[i18n-sync] Checking ko.json...
  ✗ 42 untranslated keys (present in en but not ko)
```

## Migration Plan

### Phase 1: Infrastructure (current)
- [x] `src/i18n/protocol.ts` — shared types + `create_t()`
- [ ] `scripts/i18n-migrate.ts` — convert existing TS → JSON
- [ ] `src/i18n/locales/en.json`, `ko.json` — generated from migration
- [ ] `src/i18n/index.ts` — backend entry
- [ ] `web/src/i18n/index.tsx` — refactored to use shared JSON

### Phase 2: Automation
- [ ] `scripts/i18n-sync.ts` — scan + diff + report + generate

### Phase 3: Tool Integration
- [ ] Backend tools: `description` → i18n key reference
- [ ] Delete `web/src/i18n/tool-descriptions.ts`

### Phase 4: Node Integration
- [ ] Node descriptors: `toolbar_label` + schema descriptions → i18n keys
- [ ] Node category labels → i18n keys
- [ ] Run `i18n-sync.ts --fix` to generate all missing node/tool stubs

### Phase 5: Cleanup
- [ ] Delete `web/src/i18n/en.ts`, `web/src/i18n/ko.ts`
- [ ] `tsc --noEmit` verification

## Affected Files

| File | Change |
|------|--------|
| `src/i18n/protocol.ts` | **New** — shared types |
| `src/i18n/index.ts` | **New** — backend entry |
| `src/i18n/locales/en.json` | **New** — English translations |
| `src/i18n/locales/ko.json` | **New** — Korean translations |
| `web/src/i18n/index.tsx` | **Modified** — use shared JSON |
| `web/src/i18n/en.ts` | **Deleted** (Phase 5) |
| `web/src/i18n/ko.ts` | **Deleted** (Phase 5) |
| `web/src/i18n/tool-descriptions.ts` | **Deleted** (Phase 3) |
| `scripts/i18n-migrate.ts` | **New** — one-time migration |
| `scripts/i18n-sync.ts` | **New** — ongoing automation |
| `src/agent/tools/base.ts` | **Modified** — i18n-aware description |
| `web/src/pages/workflows/node-registry.ts` | **Modified** — i18n key support |
| 76× `web/src/pages/workflows/nodes/*.tsx` | **Modified** — i18n keys in descriptors |
| 60× `src/agent/tools/*.ts` | **Modified** — i18n key descriptions |

## Design Decisions

### Why flat JSON, not nested?
- Current system already uses flat dot-notation keys (`"workflows.llm_backend"`)
- Flat keys are simpler to search (`grep "tool.exec.desc"`)
- No key collision risk from object merge
- Direct compatibility with existing `t()` function signature

### Why not colocated i18n per file?
- Considered: each node/tool defines its own `{ en: {...}, ko: {...} }` inline
- Rejected: makes adding a new language require touching 140+ files
- Centralized JSON: add `ja.json` → done, no source file changes

### Why JSON, not TS?
- JSON is language-agnostic — could be consumed by future Python/Go services
- No build step needed — backend reads directly
- Vite imports JSON natively
- Easy to validate with JSON Schema

### Backend tool descriptions and i18n
- Tool descriptions are sent to LLM in API calls — always in English
- The `description` field on Tool class remains English (LLM-facing)
- i18n keys (`tool.{name}.desc`) are for **dashboard UI display** only
- No runtime performance concern — descriptions resolved once at schema generation
