# Design: Kanban Board — Agent + Human Task Management System

> **Status**: Phase 1 complete (core CRUD), Phase 2 complete (activity log, WIP limits, automation, templates, metrics), Phase 3 in progress (due dates, time tracking, search, saved filters, SSE)

## Overview

A Kanban board system where **agents autonomously decompose work, track progress, and collaborate** through issue cards. Both humans (via dashboard) and agents (via `kanban` tool) can create/move/update cards. Each board is scoped to a workflow (project), channel, or session.

Separate from `TaskState` (auto-managed agent loop execution state). KanbanCard is a freely manipulated work item.

## Problem

Multi-agent orchestration lacks a shared workspace for task decomposition, progress tracking, and inter-agent feedback. Without it:
- Agents cannot persist work breakdown across sessions
- No structured way for QA agents to review and provide feedback to implementation agents
- Humans have no visibility into agent work progress
- Interrupted work cannot be easily resumed — agents lose context on what was done

## Architecture

```
Dashboard (UI)                    Agent (kanban tool)
  Board View / List View            kanban("create_card", ...)
  Card Detail Side Panel            kanban("move_card", ...)
         │                                │
         └────────── REST API ────────────┘
                       │
              KanbanStore (SQLite)
           kanban_boards │ kanban_cards
           kanban_comments │ kanban_relations
```

### Workflow → Auto Board Creation

When a workflow starts a project, the agent **autonomously** calls `kanban("create_board", ...)` to create a board, register issues, and begin work. No manual board creation needed.

## Data Model

### Board

```typescript
interface KanbanBoard {
  board_id: string;           // nanoid
  name: string;
  prefix: string;             // card ID prefix (e.g., "KB", "SP")
  next_seq: number;           // next card sequence (1-based)
  scope_type: "channel" | "session" | "workflow";
  scope_id: string;
  columns: KanbanColumnDef[];
  created_at: string;
  updated_at: string;
}

interface KanbanColumnDef {
  id: string;      // slug: "todo", "in_progress", "in_review", "done"
  name: string;
  color: string;   // hex
  wip_limit?: number;
}
```

**Default column preset:**

| ID | Name | Color | Meaning |
|----|------|-------|---------|
| `todo` | TODO | `#95a5a6` | Registered, not started |
| `in_progress` | In Progress | `#3498db` | Active work |
| `in_review` | In Review | `#f39c12` | Awaiting review/approval |
| `done` | Done | `#27ae60` | Completed |

### Card ID Scheme

Each board has a `next_seq` counter. Cards get **human-readable sequential IDs**:

```
{board_prefix}-{seq}   e.g., KB-1, KB-2, ISS-42
```

### Card (WorkItem)

```typescript
interface KanbanCard {
  card_id: string;           // e.g., "ISS-3"
  board_id: string;
  title: string;
  description: string;       // markdown
  column_id: string;
  position: number;          // order within column (0-based)
  priority: "urgent" | "high" | "medium" | "low" | "none";
  labels: string[];          // colored tags: "ui:#3498db", "bug:#e74c3c"
  assignee?: string;         // agent_id or "user"
  created_by: string;        // agent_id or "user:dashboard"
  task_id?: string;          // optional TaskState link
  metadata: Record<string, unknown>; // {files, commit, branch, pr_url, lines_added, ...}
  comment_count: number;
  created_at: string;
  updated_at: string;
}
```

### Relations

```typescript
interface KanbanRelation {
  relation_id: string;
  source_card_id: string;
  target_card_id: string;
  type: "blocked_by" | "blocks" | "related_to" | "parent_of" | "child_of";
}
```

### Comments (Inter-Agent Feedback)

```typescript
interface KanbanComment {
  comment_id: string;
  card_id: string;
  author: string;     // agent_id or "user:dashboard"
  text: string;
  created_at: string;
}
```

### DB Schema

```sql
CREATE TABLE kanban_boards (
  board_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  next_seq    INTEGER NOT NULL DEFAULT 1,
  scope_type  TEXT NOT NULL CHECK(scope_type IN ('channel','session','workflow')),
  scope_id    TEXT NOT NULL,
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE kanban_cards (
  card_id       TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL,
  board_id      TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  column_id     TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  priority      TEXT NOT NULL DEFAULT 'none',
  labels_json   TEXT NOT NULL DEFAULT '[]',
  assignee      TEXT,
  created_by    TEXT NOT NULL,
  task_id       TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kanban_comments (
  comment_id  TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kanban_relations (
  relation_id      TEXT PRIMARY KEY,
  source_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  target_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  UNIQUE(source_card_id, target_card_id, type)
);
```

DB location: `{workspace}/runtime/kanban.db`

## Agent Tool: `kanban`

Single tool, `action` parameter dispatch (same pattern as `memory`, `cron`, `workflow` tools):

| Action | Parameters | Description |
|--------|-----------|-------------|
| `create_board` | `name, scope_type, scope_id, columns?` | Create board (default 4 columns) |
| `list_boards` | `scope_type?, scope_id?` | List boards |
| `create_card` | `board_id, title, description?, column_id?, priority?, labels?, assignee?, parent_id?` | Create card. `parent_id` creates subtask relation |
| `move_card` | `card_id, column_id, position?` | Move card between columns |
| `update_card` | `card_id, title?, description?, priority?, labels?, assignee?, metadata?` | Update card fields |
| `add_relation` | `source_card_id, target_card_id, type` | Add relation between cards |
| `remove_relation` | `relation_id` | Remove relation |
| `list_cards` | `board_id, column_id?, limit?` | List cards |
| `comment` | `card_id, text` | Add comment (inter-agent feedback) |
| `list_comments` | `card_id, limit?` | List card comments |
| `get_card` | `card_id` | Card detail (description, metadata, comments) |
| `board_summary` | `board_id` | Board overview (column counts, progress, blockers) |
| `archive_card` | `card_id` | Delete card |

### Subtasks

Cards can have subtasks via `parent_of`/`child_of` relations:

```
kanban("create_card", {board_id: "abc", title: "Write DB migration", parent_id: "ISS-3"})
```

- Parent card shows **Subtasks** section with checklist and progress bar
- Board view shows `[2/5]` badge on parent cards
- List view shows `>` toggle to expand subtasks (indented)

### Worktree Integration

Each card (issue) can have an isolated git worktree:

```
Agent starts ISS-3 → move to in_progress
→ git worktree add /workspace/.worktrees/ISS-3 -b issue/ISS-3
→ Work in isolated worktree
→ update_card with metadata: {branch, worktree, files, lines_added, lines_removed}
```

### PR-Based Code Review Flow

```
Impl agent: push + create PR → update_card metadata (pr_url, files, stats)
           → move to in_review, assign QA agent
QA agent:    read PR metadata → review code → comment feedback
           → move back to in_progress if issues found
Impl agent:  fix issues → push → move to in_review
QA agent:    approve → merge → move to done
```

### Participants

Auto-extracted from `created_by` + `assignee` + comment `author`. Displayed as avatar icons (max 3 + "+N") on card footer.

## Activity Log

Automatic audit trail for all card changes. Every mutation (create, move, update, archive, comment, relation) generates an activity record.

### Data Model

```typescript
type ActivityAction = "created" | "moved" | "updated" | "archived" | "commented"
  | "relation_added" | "relation_removed" | "assigned" | "priority_changed" | "labels_changed";

interface KanbanActivity {
  activity_id: string;
  card_id: string;
  board_id: string;
  actor: string;          // agent_id or "user:dashboard"
  action: ActivityAction;
  detail: Record<string, unknown>;  // {from: "todo", to: "in_progress"} etc.
  created_at: string;
}
```

### DB Schema

```sql
CREATE TABLE kanban_activities (
  activity_id TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
  board_id    TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activities_card ON kanban_activities(card_id, created_at);
CREATE INDEX idx_activities_board ON kanban_activities(board_id, created_at);
```

### Agent Tool Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `list_activities` | `card_id?, board_id?, limit?` | List activity log entries |

Activities are recorded automatically by the store on every mutation — agents do not need to call a separate action to log.

### UI: Activity Tab

CardDetailPanel gains a tab bar: `[Comments | Activity]`

- **Activity tab**: chronological list of all changes
- Each entry: `"agent-impl moved ISS-3 from todo to in_progress" — 2m ago`
- Color-coded action badges (green=created, blue=moved, orange=updated, red=archived)

## WIP Limits

Column WIP (Work-In-Progress) limits are now enforced. The `wip_limit` field in `KanbanColumnDef` controls how many cards can be active in a column.

### Behavior

- **move_card**: If target column is at/over WIP limit, return a warning message but still allow the move (soft limit)
- **Agent tool response**: `"ISS-5 moved to in_progress (WARNING: column WIP limit 3 exceeded, now 4 cards)"`
- **UI**: Column header shows `3/3` count in red when at limit, card count exceeds limit shows red background

### No schema changes needed — uses existing `wip_limit` field in `columns_json`.

## Board Automation Rules

Board-level trigger-action rules. Configured by agents or humans.

### Data Model

```typescript
interface KanbanRule {
  rule_id: string;
  board_id: string;
  trigger: "card_moved" | "subtasks_done" | "card_stale";
  condition: Record<string, unknown>;   // {to_column: "in_review"}
  action_type: "move_card" | "assign" | "add_label" | "comment";
  action_params: Record<string, unknown>; // {assignee: "qa-agent"}
  enabled: boolean;
  created_at: string;
}
```

### DB Schema

```sql
CREATE TABLE kanban_rules (
  rule_id       TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL CHECK(trigger IN ('card_moved','subtasks_done','card_stale')),
  condition_json TEXT NOT NULL DEFAULT '{}',
  action_type   TEXT NOT NULL CHECK(action_type IN ('move_card','assign','add_label','comment')),
  action_params_json TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rules_board ON kanban_rules(board_id);
```

### Triggers

| Trigger | Condition | Example |
|---------|-----------|---------|
| `card_moved` | `{to_column: "in_review"}` | When a card lands in "in_review" |
| `subtasks_done` | `{}` | When all subtasks of a parent card are done |
| `card_stale` | `{column: "in_progress", hours: 24}` | Card stuck in column for N hours |

### Actions

| Action | Params | Example |
|--------|--------|---------|
| `move_card` | `{column_id: "in_review"}` | Auto-move parent when subtasks done |
| `assign` | `{assignee: "qa-agent"}` | Auto-assign reviewer |
| `add_label` | `{label: "stale:#e74c3c"}` | Mark stale cards |
| `comment` | `{text: "All subtasks complete"}` | Auto-comment |

### Agent Tool Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `add_rule` | `board_id, trigger, condition, action_type, action_params` | Create automation rule |
| `list_rules` | `board_id` | List board rules |
| `remove_rule` | `rule_id` | Delete rule |
| `toggle_rule` | `rule_id, enabled` | Enable/disable rule |

### Execution

- `card_moved` / `subtasks_done`: evaluated synchronously after the triggering mutation
- `card_stale`: evaluated by cron scheduler (piggyback on existing `cron.db` infrastructure)

### UI: Rules Panel

Board header gains a gear icon → opens Rules modal:

```
Automation Rules (3 active)
┌─────────────────────────────────────────────┐
│ [ON]  When card moved to "In Review"        │
│       → Assign to qa-agent                  │
│                                    [Edit][X] │
├─────────────────────────────────────────────┤
│ [ON]  When all subtasks done                │
│       → Move parent to "In Review"          │
│                                    [Edit][X] │
├─────────────────────────────────────────────┤
│ [OFF] When card in "In Progress" > 24h      │
│       → Add label "stale"                   │
│                                    [Edit][X] │
└─────────────────────────────────────────────┘
[+ Add Rule]
```

## Board Templates

Reusable board + initial card presets for recurring project types.

### Data Model

```typescript
interface KanbanTemplate {
  template_id: string;
  name: string;
  description: string;
  columns?: KanbanColumnDef[];  // custom columns (null = use defaults)
  cards: Array<{
    title: string;
    description?: string;
    column_id?: string;
    priority?: Priority;
    labels?: string[];
  }>;
  created_at: string;
}
```

### DB Schema

```sql
CREATE TABLE kanban_templates (
  template_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  columns_json TEXT,                        -- null = use default columns
  cards_json   TEXT NOT NULL DEFAULT '[]',  -- initial card definitions
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Agent Tool Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `create_template` | `name, description?, columns?, cards` | Save a board template |
| `list_templates` | — | List available templates |
| `create_board_from_template` | `template, scope_type, scope_id, name?` | Create board from template |
| `delete_template` | `template_id` | Delete template |

### Example

```
Agent: kanban("create_board_from_template", {
  template: "feature-development",
  scope_type: "workflow", scope_id: "auth-refactor"
})
← Board "Auth Refactor" created with 4 pre-defined cards
```

### UI: Template Picker

CreateBoardModal gains a "From Template" tab:

```
[Blank Board | From Template]

Available Templates:
┌─────────────────────────────────┐
│  Feature Development            │
│  Design → Implement → Test      │
│  4 initial cards                │
│                        [Use]    │
├─────────────────────────────────┤
│  Bug Triage                     │
│  Report → Reproduce → Fix       │
│  3 initial cards                │
│                        [Use]    │
└─────────────────────────────────┘
```

## Board Metrics

Quantitative project health indicators. Requires Activity Log data.

### Agent Tool Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `board_metrics` | `board_id, days?` | Velocity, cycle time, throughput |

### Response

```typescript
interface BoardMetrics {
  board_id: string;
  period_days: number;
  cards_completed: number;         // done in period
  avg_cycle_time_hours: number;    // avg time from created → done
  avg_review_time_hours: number;   // avg time in in_review
  throughput_per_day: number;      // cards done / days
  column_distribution: Record<string, number>;  // current counts
  stale_cards: Array<{ card_id: string; title: string; column_id: string; hours_stuck: number }>;
}
```

Cycle time is computed from `kanban_activities`:
- `created` → first `moved to done` timestamp delta per card

### UI: Metrics Panel

Board header gains a chart icon → opens Metrics panel:

```
Board Metrics (last 7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Completed:     12 cards
Avg Cycle Time: 4.2h
Review Time:    1.1h
Throughput:     1.7/day

Column Distribution:
  TODO        ████████ 8
  In Progress ███ 3
  In Review   ██ 2
  Done        ████████████ 12

Stale Cards (>24h in same column):
  ISS-7 "Fix auth bug" — In Progress — 36h
  ISS-13 "Caching"     — TODO        — 48h
```

## Card Due Dates & Overdue Detection

Cards gain a `due_date` field for deadline management. Agents set deadlines when decomposing work; the system flags overdue cards.

### Data Model Changes

```typescript
// Added to KanbanCard
interface KanbanCard {
  // ... existing fields ...
  due_date?: string;  // ISO date (date only, no time)
}
```

### DB Schema

```sql
ALTER TABLE kanban_cards ADD COLUMN due_date TEXT;
CREATE INDEX idx_cards_due ON kanban_cards(due_date) WHERE due_date IS NOT NULL;
```

### Behavior

- `create_card` / `update_card` accept optional `due_date` parameter
- `board_summary` includes `overdue` array: cards where `due_date < today AND column_id != 'done'`
- Integrates with `card_stale` automation trigger: condition `{overdue: true}` matches cards past due date
- Activity log records `due_date_set` action when due date is set/changed

### Agent Tool

| Action | Parameters | Description |
|--------|-----------|-------------|
| `update_card` | `card_id, due_date` | Set/clear due date (ISO date or null) |
| `list_cards` | `board_id, overdue?` | Filter overdue cards only |

### UI

- Card badge: `📅 Mar 15` (gray), `📅 Overdue` (red, pulsing)
- Detail panel: date picker in metadata section
- List view: Due column with color coding (green=future, yellow=today, red=overdue)

## Card Time Tracking

Auto-computed column dwell time from Activity Log `moved` events. No manual input needed.

### Interface

```typescript
interface ColumnDwellTime {
  column_id: string;
  entered_at: string;
  exited_at?: string;    // null = still in column
  duration_hours: number;
}

interface CardTimeTracking {
  card_id: string;
  total_hours: number;
  column_times: ColumnDwellTime[];
}
```

### Computation

Derived from `kanban_activities` where `action = 'moved'`:
1. Walk `moved` events chronologically for a card
2. Each `{from, to}` pair defines an exit from `from` and entry to `to`
3. First entry = card `created_at` into its initial column
4. Current column has no exit (uses `now()` for duration)

### Agent Tool

| Action | Parameters | Description |
|--------|-----------|-------------|
| `card_time_tracking` | `card_id` | Column dwell times for a card |

### Board Metrics Extension

`get_board_metrics` gains:
```typescript
interface BoardMetrics {
  // ... existing fields ...
  avg_column_dwell_hours: Record<string, number>;  // avg hours per column
  bottleneck_column?: string;  // column with highest avg dwell time
}
```

### UI

Card detail panel → Timeline section:
```
Time Tracking
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODO         ██ 2.1h
In Progress  ████████ 8.5h
In Review    ███ 3.2h        ← current
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 13.8h
```

## Cross-Board Card Search

Full-text search across all boards. Agents find related work or detect duplicate issues.

### Interface

```typescript
interface SearchResult {
  card_id: string;
  board_id: string;
  board_name: string;
  title: string;
  description_snippet: string;
  column_id: string;
  priority: Priority;
  score: number;  // relevance
}
```

### Implementation

Uses SQLite LIKE for simplicity (FTS5 upgrade path available):
- Searches: `title`, `description`, `card_id`, `labels_json`
- Optional filters: `board_id`, `column_id`, `priority`, `assignee`
- Results sorted by relevance (exact card_id match > title > description)

### Agent Tool

| Action | Parameters | Description |
|--------|-----------|-------------|
| `search` | `query, board_id?, limit?` | Search cards across boards |

### REST API

```
GET /api/kanban/search?q=auth&board_id=...&limit=20
```

### UI

- Global search bar in BoardHeader (already exists as filter)
- Results dropdown: card_id, title, board name, status badge
- Click → navigate to board + open card detail

## Saved Filters

Named filter presets per board. Quick view switching for common queries.

### Data Model

```typescript
interface KanbanFilter {
  filter_id: string;
  board_id: string;
  name: string;
  criteria: FilterCriteria;
  created_by: string;
  created_at: string;
}

interface FilterCriteria {
  column_ids?: string[];
  priority?: Priority[];
  assignee?: string;
  labels?: string[];
  due_before?: string;    // ISO date
  overdue?: boolean;
  search?: string;
}
```

### DB Schema

```sql
CREATE TABLE kanban_filters (
  filter_id    TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  criteria_json TEXT NOT NULL DEFAULT '{}',
  created_by   TEXT NOT NULL DEFAULT 'user:dashboard',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(board_id, name)
);
```

### Agent Tool

| Action | Parameters | Description |
|--------|-----------|-------------|
| `save_filter` | `board_id, name, criteria` | Save a named filter |
| `list_filters` | `board_id` | List saved filters |
| `delete_filter` | `filter_id` | Delete filter |

### REST API

```
GET    /api/kanban/boards/:id/filters     List saved filters
POST   /api/kanban/boards/:id/filters     Create filter
DELETE /api/kanban/filters/:id            Delete filter
```

### UI

FilterBar gains a dropdown of saved filters:
```
[Active ▾] [My Tasks] [Urgent Blockers] [QA Queue] [+ Save Current]
```

## Board Event Stream (SSE)

Real-time push updates via Server-Sent Events. Replaces 15-second polling for active boards.

### Endpoint

```
GET /api/kanban/boards/:id/events    SSE stream
```

### Events

```typescript
type KanbanEvent =
  | { type: "card_created"; card: KanbanCard }
  | { type: "card_moved"; card_id: string; from: string; to: string }
  | { type: "card_updated"; card_id: string; changes: Record<string, unknown> }
  | { type: "card_deleted"; card_id: string }
  | { type: "comment_added"; card_id: string; comment: KanbanComment }
```

### Implementation

- `KanbanStore.log_activity()` emits to an in-memory `EventEmitter` per board
- SSE handler subscribes to the emitter on connection, unsubscribes on close
- Heartbeat every 30s to keep connection alive
- Frontend: `EventSource` → on message → `queryClient.invalidateQueries(["kanban", boardId])`
- Fallback: if SSE connection fails, auto-revert to 15s polling

### UI

- Connection indicator in board header: `●` (green=connected, gray=polling)
- No user interaction needed — automatic upgrade from polling

## REST API

> Extended with new endpoints for activities, rules, templates, metrics, search, filters, and SSE.

```
GET    /api/kanban/boards                     Board list (scope filter via query)
POST   /api/kanban/boards                     Create board
GET    /api/kanban/boards/:id                 Board detail (columns + all cards)
PUT    /api/kanban/boards/:id                 Update board (name, columns)
DELETE /api/kanban/boards/:id                 Delete board

POST   /api/kanban/boards/:id/cards           Create card
PUT    /api/kanban/cards/:id                  Update/move card
DELETE /api/kanban/cards/:id                  Delete card

GET    /api/kanban/cards/:id/comments         List comments
POST   /api/kanban/cards/:id/comments         Add comment

POST   /api/kanban/cards/:id/relations        Add relation
DELETE /api/kanban/relations/:id              Remove relation

GET    /api/kanban/cards/:id/activities       Card activity log
GET    /api/kanban/boards/:id/activities      Board activity log

GET    /api/kanban/boards/:id/rules           List automation rules
POST   /api/kanban/boards/:id/rules           Create rule
PUT    /api/kanban/rules/:id                  Update rule (toggle, edit)
DELETE /api/kanban/rules/:id                  Delete rule

GET    /api/kanban/templates                  List templates
POST   /api/kanban/templates                  Create template
DELETE /api/kanban/templates/:id              Delete template
POST   /api/kanban/templates/:id/apply        Create board from template

GET    /api/kanban/boards/:id/metrics         Board metrics (query: days)

GET    /api/kanban/search                     Cross-board card search (query: q, board_id?, limit?)

GET    /api/kanban/boards/:id/filters         List saved filters
POST   /api/kanban/boards/:id/filters         Create saved filter
DELETE /api/kanban/filters/:id                Delete saved filter

GET    /api/kanban/boards/:id/events          SSE event stream

GET    /api/kanban/cards/:id/time-tracking    Card column dwell times
```

## Frontend

### Views

Two views toggled via `[Board | List]` button, same data:

- **Board View** (default): Kanban column layout with drag-and-drop
- **List View**: Sortable table (priority, status, updated_at), Linear-style

Both views share the same `CardDetailPanel` (slide-in side panel, not modal).

### Component Structure

```
KanbanPage
├── BoardHeader
│   ├── BoardSelector (dropdown, board switch)
│   ├── ViewToggle [Board | List]
│   ├── FilterBar (Active/All/Backlog/Done + saved filters + search)
│   ├── NewIssueButton (blank or from template)
│   ├── RulesButton (gear icon → RulesModal)
│   ├── MetricsButton (chart icon → MetricsPanel)
│   └── SSEIndicator (● green=connected, gray=polling)
├── KanbanBoard / IssueListView (switched by view mode)
│   ├── KanbanColumn × N (WIP count + limit badge)
│   │   └── KanbanCard × N (subtask badge, participants)
│   └── IssueRow × N (list view, expandable subtasks)
├── CardDetailPanel (slide-in)
│   ├── Header (card_id, status, priority, assignee, due_date — all editable)
│   ├── Title (inline edit)
│   ├── Labels (add/remove)
│   ├── Description (textarea)
│   ├── Subtasks (checklist + progress bar)
│   ├── TimeTracking (column dwell bar chart)
│   ├── Workspaces (branch, files, PR link, git stats)
│   ├── Relationships (blocked_by, related_to)
│   ├── TabBar [Comments | Activity]
│   │   ├── Comments (thread + input)
│   │   └── Activity (auto-generated changelog)
│   └── Delete button
├── RulesModal (board automation rules CRUD)
├── MetricsPanel (velocity, cycle time, stale cards)
└── CreateBoardModal (blank board or from template picker)
```

### Mobile

- Board: horizontal scroll with CSS snap (85vw per column)
- Detail panel: fullscreen overlay
- Touch targets: min 36px

## File Structure

### New Files

| File | Description |
|------|-------------|
| `src/services/kanban-store.ts` | SQLite store (CRUD) |
| `src/agent/tools/kanban.ts` | Agent tool (28 actions) |
| `src/dashboard/routes/kanban.ts` | REST API handler |
| `web/src/pages/kanban.tsx` | Kanban page (board + list + detail) |
| `web/src/styles/kanban.css` | Kanban styles |

### Modified Files

| File | Change |
|------|--------|
| `web/src/router.tsx` | `/kanban`, `/kanban/:boardId` routes |
| `web/src/layouts/sidebar.tsx` | Nav item (Main group) |
| `src/agent/tools/index.ts` | KanbanTool registration |
| `src/dashboard/service.ts` | Kanban route registration |
| `src/main.ts` | KanbanStore init + tool injection |
| `src/i18n/locales/{en,ko}.json` | `kanban.*` keys (~30) |

## Related Documents

-> [Phase Loop](./phase-loop.md) — Workflow execution engine (board scope: workflow)
-> [PTY Agent Backend](./pty-agent-backend.md) — Worktree isolation patterns
-> [Loop Continuity & HITL](./loop-continuity-hitl.md) — TaskState (separate from Kanban cards)
