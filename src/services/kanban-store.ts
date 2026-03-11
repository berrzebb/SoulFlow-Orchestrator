/** 칸반 보드 SQLite 스토어 — 에이전트 + 사람 공용 작업 관리. */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { with_sqlite, type DatabaseSync } from "../utils/sqlite-helper.js";
import { now_iso } from "../utils/common.js";

/* ─── 타입 ─── */

export type ScopeType = "channel" | "session" | "workflow";
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type RelationType = "blocked_by" | "blocks" | "related_to" | "parent_of" | "child_of";

export interface KanbanColumnDef {
  id: string;
  name: string;
  color: string;
  wip_limit?: number;
}

export interface KanbanBoard {
  board_id: string;
  name: string;
  prefix: string;
  next_seq: number;
  scope_type: ScopeType;
  scope_id: string;
  columns: KanbanColumnDef[];
  created_at: string;
  updated_at: string;
}

export interface KanbanCard {
  card_id: string;
  seq: number;
  board_id: string;
  title: string;
  description: string;
  column_id: string;
  position: number;
  priority: Priority;
  labels: string[];
  assignee?: string;
  created_by: string;
  task_id?: string;
  due_date?: string;
  metadata: Record<string, unknown>;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface KanbanComment {
  comment_id: string;
  card_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface KanbanRelation {
  relation_id: string;
  source_card_id: string;
  target_card_id: string;
  type: RelationType;
}

export type ActivityAction = "created" | "moved" | "updated" | "archived" | "commented"
  | "relation_added" | "relation_removed" | "assigned" | "priority_changed" | "labels_changed" | "due_date_set";

export interface KanbanActivity {
  activity_id: string;
  card_id: string;
  board_id: string;
  actor: string;
  action: ActivityAction;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface KanbanRule {
  rule_id: string;
  board_id: string;
  trigger: "card_moved" | "subtasks_done" | "card_stale";
  condition: Record<string, unknown>;
  action_type: "move_card" | "assign" | "add_label" | "comment" | "run_workflow" | "create_task";
  action_params: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface KanbanTemplate {
  template_id: string;
  name: string;
  description: string;
  columns?: KanbanColumnDef[];
  cards: Array<{ title: string; description?: string; column_id?: string; priority?: Priority; labels?: string[] }>;
  created_at: string;
}

export interface ColumnDwellTime {
  column_id: string;
  entered_at: string;
  exited_at?: string;
  duration_hours: number;
}

export interface CardTimeTracking {
  card_id: string;
  total_hours: number;
  column_times: ColumnDwellTime[];
}

export interface SearchResult {
  card_id: string;
  board_id: string;
  board_name: string;
  title: string;
  description_snippet: string;
  column_id: string;
  priority: Priority;
  score: number;
}

export interface KanbanFilter {
  filter_id: string;
  board_id: string;
  name: string;
  criteria: FilterCriteria;
  created_by: string;
  created_at: string;
}

export interface FilterCriteria {
  column_ids?: string[];
  priority?: Priority[];
  assignee?: string;
  labels?: string[];
  due_before?: string;
  overdue?: boolean;
  search?: string;
}

/* ─── 입력 타입 ─── */

export interface CreateBoardInput {
  name: string;
  scope_type: ScopeType;
  scope_id: string;
  columns?: KanbanColumnDef[];
}

export interface CreateCardInput {
  board_id: string;
  title: string;
  description?: string;
  column_id?: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string;
  created_by: string;
  parent_id?: string;
  task_id?: string;
  due_date?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCardInput {
  title?: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  assignee?: string | null;
  metadata?: Record<string, unknown>;
  task_id?: string | null;
  due_date?: string | null;
  /** 변경 수행자 (activity 기록용). 미지정 시 "system". */
  actor?: string;
}

/* ─── DB row 타입 ─── */

interface BoardRow {
  board_id: string;
  name: string;
  prefix: string;
  next_seq: number;
  scope_type: string;
  scope_id: string;
  columns_json: string;
  created_at: string;
  updated_at: string;
}

interface CardRow {
  card_id: string;
  seq: number;
  board_id: string;
  title: string;
  description: string;
  column_id: string;
  position: number;
  priority: string;
  labels_json: string;
  assignee: string | null;
  created_by: string;
  task_id: string | null;
  due_date: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface FilterRow {
  filter_id: string;
  board_id: string;
  name: string;
  criteria_json: string;
  created_by: string;
  created_at: string;
}

interface CommentRow {
  comment_id: string;
  card_id: string;
  author: string;
  text: string;
  created_at: string;
}

interface RelationRow {
  relation_id: string;
  source_card_id: string;
  target_card_id: string;
  type: string;
}

interface ActivityRow {
  activity_id: string;
  card_id: string;
  board_id: string;
  actor: string;
  action: string;
  detail_json: string;
  created_at: string;
}

interface RuleRow {
  rule_id: string;
  board_id: string;
  trigger: string;
  condition_json: string;
  action_type: string;
  action_params_json: string;
  enabled: number;
  created_at: string;
}

interface TemplateRow {
  template_id: string;
  name: string;
  description: string;
  columns_json: string | null;
  cards_json: string;
  created_at: string;
}

/* ─── 기본 컬럼 프리셋 ─── */

const DEFAULT_COLUMNS: KanbanColumnDef[] = [
  { id: "todo", name: "TODO", color: "#95a5a6" },
  { id: "in_progress", name: "In Progress", color: "#3498db" },
  { id: "in_review", name: "In Review", color: "#f39c12" },
  { id: "done", name: "Done", color: "#27ae60" },
];

/* ─── 헬퍼 ─── */

/** 보드 이름에서 prefix 자동 추출 (대문자 첫 글자들, 최소 2자). */
function derive_prefix(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) {
    return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
  }
  return name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 3) || "KB";
}

function parse_json_safe<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function row_to_board(r: BoardRow): KanbanBoard {
  return {
    board_id: r.board_id,
    name: r.name,
    prefix: r.prefix,
    next_seq: r.next_seq,
    scope_type: r.scope_type as ScopeType,
    scope_id: r.scope_id,
    columns: parse_json_safe<KanbanColumnDef[]>(r.columns_json, []),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function row_to_card(r: CardRow, comment_count = 0): KanbanCard {
  return {
    card_id: r.card_id,
    seq: r.seq,
    board_id: r.board_id,
    title: r.title,
    description: r.description,
    column_id: r.column_id,
    position: r.position,
    priority: r.priority as Priority,
    labels: parse_json_safe<string[]>(r.labels_json, []),
    assignee: r.assignee ?? undefined,
    created_by: r.created_by,
    task_id: r.task_id ?? undefined,
    due_date: r.due_date ?? undefined,
    metadata: parse_json_safe<Record<string, unknown>>(r.metadata_json, {}),
    comment_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function row_to_filter(r: FilterRow): KanbanFilter {
  return { filter_id: r.filter_id, board_id: r.board_id, name: r.name, criteria: parse_json_safe(r.criteria_json, {}), created_by: r.created_by, created_at: r.created_at };
}

function row_to_comment(r: CommentRow): KanbanComment {
  return { comment_id: r.comment_id, card_id: r.card_id, author: r.author, text: r.text, created_at: r.created_at };
}

function row_to_relation(r: RelationRow): KanbanRelation {
  return { relation_id: r.relation_id, source_card_id: r.source_card_id, target_card_id: r.target_card_id, type: r.type as RelationType };
}

function row_to_activity(r: ActivityRow): KanbanActivity {
  return { activity_id: r.activity_id, card_id: r.card_id, board_id: r.board_id, actor: r.actor, action: r.action as ActivityAction, detail: parse_json_safe(r.detail_json, {}), created_at: r.created_at };
}

function row_to_rule(r: RuleRow): KanbanRule {
  return { rule_id: r.rule_id, board_id: r.board_id, trigger: r.trigger as KanbanRule["trigger"], condition: parse_json_safe(r.condition_json, {}), action_type: r.action_type as KanbanRule["action_type"], action_params: parse_json_safe(r.action_params_json, {}), enabled: r.enabled === 1, created_at: r.created_at };
}

function row_to_template(r: TemplateRow): KanbanTemplate {
  return { template_id: r.template_id, name: r.name, description: r.description, columns: r.columns_json ? parse_json_safe<KanbanColumnDef[]>(r.columns_json, undefined as unknown as KanbanColumnDef[]) : undefined, cards: parse_json_safe(r.cards_json, []), created_at: r.created_at };
}

/** SSE 이벤트 페이로드. */
export interface KanbanEvent {
  type: "activity";
  board_id: string;
  data: KanbanActivity;
}

export type KanbanEventListener = (event: KanbanEvent) => void;

/* ─── 인터페이스 ─── */

export interface KanbanStoreLike {
  /* board */
  create_board(input: CreateBoardInput): Promise<KanbanBoard>;
  get_board(board_id: string): Promise<KanbanBoard | null>;
  list_boards(scope_type?: ScopeType, scope_id?: string): Promise<KanbanBoard[]>;
  update_board(board_id: string, updates: { name?: string; columns?: KanbanColumnDef[] }): Promise<KanbanBoard | null>;
  delete_board(board_id: string): Promise<boolean>;

  /* card */
  create_card(input: CreateCardInput): Promise<KanbanCard>;
  get_card(card_id: string): Promise<KanbanCard | null>;
  list_cards(board_id: string, column_id?: string, limit?: number, assignee?: string): Promise<KanbanCard[]>;
  move_card(card_id: string, column_id: string, position?: number, actor?: string): Promise<KanbanCard | null>;
  update_card(card_id: string, updates: UpdateCardInput): Promise<KanbanCard | null>;
  delete_card(card_id: string): Promise<boolean>;

  /* comment */
  add_comment(card_id: string, author: string, text: string): Promise<KanbanComment>;
  list_comments(card_id: string, limit?: number): Promise<KanbanComment[]>;

  /* relation */
  add_relation(source_card_id: string, target_card_id: string, type: RelationType): Promise<KanbanRelation>;
  remove_relation(relation_id: string): Promise<boolean>;
  list_relations(card_id: string): Promise<KanbanRelation[]>;

  /* query */
  get_card_by_readable_id(readable_id: string): Promise<KanbanCard | null>;
  board_summary(board_id: string): Promise<BoardSummary | null>;
  get_subtasks(parent_card_id: string): Promise<KanbanCard[]>;
  get_participants(card_id: string): Promise<string[]>;
  get_subtask_counts(board_id: string): Promise<Map<string, { total: number; done: number }>>;

  /* activity */
  log_activity(card_id: string, board_id: string, actor: string, action: ActivityAction, detail?: Record<string, unknown>): Promise<KanbanActivity>;
  list_activities(opts: { card_id?: string; board_id?: string; limit?: number }): Promise<KanbanActivity[]>;

  /* rules */
  add_rule(input: { board_id: string; trigger: KanbanRule["trigger"]; condition: Record<string, unknown>; action_type: KanbanRule["action_type"]; action_params: Record<string, unknown> }): Promise<KanbanRule>;
  list_rules(board_id: string): Promise<KanbanRule[]>;
  update_rule(rule_id: string, updates: { enabled?: boolean; condition?: Record<string, unknown>; action_params?: Record<string, unknown> }): Promise<KanbanRule | null>;
  remove_rule(rule_id: string): Promise<boolean>;
  get_rules_by_trigger(board_id: string, trigger: KanbanRule["trigger"]): Promise<KanbanRule[]>;

  /* templates */
  create_template(input: { name: string; description?: string; columns?: KanbanColumnDef[]; cards: KanbanTemplate["cards"] }): Promise<KanbanTemplate>;
  list_templates(): Promise<KanbanTemplate[]>;
  get_template(template_id_or_name: string): Promise<KanbanTemplate | null>;
  delete_template(template_id: string): Promise<boolean>;

  /* metrics */
  get_board_metrics(board_id: string, days?: number): Promise<BoardMetrics | null>;

  /* time tracking */
  get_card_time_tracking(card_id: string): Promise<CardTimeTracking | null>;

  /* search */
  search_cards(query: string, opts?: { board_id?: string; limit?: number }): Promise<SearchResult[]>;

  /* filters */
  save_filter(input: { board_id: string; name: string; criteria: FilterCriteria; created_by?: string }): Promise<KanbanFilter>;
  list_filters(board_id: string): Promise<KanbanFilter[]>;
  delete_filter(filter_id: string): Promise<boolean>;

  /* event stream */
  subscribe(board_id: string, listener: KanbanEventListener): void;
  unsubscribe(board_id: string, listener: KanbanEventListener): void;
}

export interface BoardSummary {
  board_id: string;
  name: string;
  columns: Array<{ id: string; name: string; color: string; count: number }>;
  total: number;
  done: number;
  blockers: Array<{ card_id: string; title: string; blocked_by: string[] }>;
  overdue: Array<{ card_id: string; title: string; due_date: string; column_id: string }>;
}

export interface BoardMetrics {
  board_id: string;
  period_days: number;
  throughput: number;
  avg_cycle_time_hours: number;
  cards_by_column: Record<string, number>;
  cards_by_priority: Record<string, number>;
  velocity: Array<{ week: string; done: number }>;
}

/* ─── 구현 ─── */

export class KanbanStore implements KanbanStoreLike {
  private readonly sqlite_path: string;
  private readonly initialized: Promise<void>;
  private readonly emitter = new EventEmitter();

  constructor(runtime_dir: string) {
    this.sqlite_path = join(runtime_dir, "kanban.db");
    this.initialized = this.ensure_initialized(runtime_dir);
    this.emitter.setMaxListeners(100);
  }

  private async ensure_initialized(runtime_dir: string): Promise<void> {
    await mkdir(runtime_dir, { recursive: true });
    with_sqlite(this.sqlite_path, (db) => {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS kanban_boards (
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

        CREATE TABLE IF NOT EXISTS kanban_cards (
          card_id       TEXT PRIMARY KEY,
          seq           INTEGER NOT NULL,
          board_id      TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
          title         TEXT NOT NULL,
          description   TEXT NOT NULL DEFAULT '',
          column_id     TEXT NOT NULL,
          position      INTEGER NOT NULL DEFAULT 0,
          priority      TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('urgent','high','medium','low','none')),
          labels_json   TEXT NOT NULL DEFAULT '[]',
          assignee      TEXT,
          created_by    TEXT NOT NULL,
          task_id       TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cards_board_col ON kanban_cards(board_id, column_id, position);
        CREATE INDEX IF NOT EXISTS idx_cards_task ON kanban_cards(task_id) WHERE task_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS kanban_comments (
          comment_id  TEXT PRIMARY KEY,
          card_id     TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
          author      TEXT NOT NULL,
          text        TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_comments_card ON kanban_comments(card_id, created_at);

        CREATE TABLE IF NOT EXISTS kanban_relations (
          relation_id      TEXT PRIMARY KEY,
          source_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
          target_card_id   TEXT NOT NULL REFERENCES kanban_cards(card_id) ON DELETE CASCADE,
          type             TEXT NOT NULL CHECK(type IN ('blocked_by','blocks','related_to','parent_of','child_of')),
          UNIQUE(source_card_id, target_card_id, type)
        );
        CREATE INDEX IF NOT EXISTS idx_relations_source ON kanban_relations(source_card_id);
        CREATE INDEX IF NOT EXISTS idx_relations_target ON kanban_relations(target_card_id);

        CREATE TABLE IF NOT EXISTS kanban_activities (
          activity_id TEXT PRIMARY KEY,
          card_id     TEXT NOT NULL,
          board_id    TEXT NOT NULL,
          actor       TEXT NOT NULL,
          action      TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_activities_card ON kanban_activities(card_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_activities_board ON kanban_activities(board_id, created_at);

        CREATE TABLE IF NOT EXISTS kanban_rules (
          rule_id          TEXT PRIMARY KEY,
          board_id         TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
          trigger          TEXT NOT NULL CHECK(trigger IN ('card_moved','subtasks_done','card_stale')),
          condition_json   TEXT NOT NULL DEFAULT '{}',
          action_type      TEXT NOT NULL CHECK(action_type IN ('move_card','assign','add_label','comment','run_workflow','create_task')),
          action_params_json TEXT NOT NULL DEFAULT '{}',
          enabled          INTEGER NOT NULL DEFAULT 1,
          created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_rules_board ON kanban_rules(board_id, trigger);

        CREATE TABLE IF NOT EXISTS kanban_templates (
          template_id  TEXT PRIMARY KEY,
          name         TEXT NOT NULL UNIQUE,
          description  TEXT NOT NULL DEFAULT '',
          columns_json TEXT,
          cards_json   TEXT NOT NULL DEFAULT '[]',
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS kanban_filters (
          filter_id    TEXT PRIMARY KEY,
          board_id     TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
          name         TEXT NOT NULL,
          criteria_json TEXT NOT NULL DEFAULT '{}',
          created_by   TEXT NOT NULL DEFAULT 'user:dashboard',
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(board_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_filters_board ON kanban_filters(board_id);
      `);

      /* due_date 컬럼 마이그레이션 — 테이블 존재 후 ALTER */
      try {
        db.exec("ALTER TABLE kanban_cards ADD COLUMN due_date TEXT");
      } catch { /* 이미 존재 */ }
      try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_cards_due ON kanban_cards(due_date) WHERE due_date IS NOT NULL");
      } catch { /* no-op */ }
      return true;
    });
  }

  private db<T>(fn: (db: DatabaseSync) => T): T | null {
    return with_sqlite(this.sqlite_path, fn, { pragmas: ["foreign_keys=ON"] });
  }

  /* ═══ Board ═══ */

  async create_board(input: CreateBoardInput): Promise<KanbanBoard> {
    await this.initialized;
    const board_id = randomUUID();
    const prefix = derive_prefix(input.name);
    const columns = input.columns ?? DEFAULT_COLUMNS;
    const ts = now_iso();
    this.db((db) => {
      db.prepare(`
        INSERT INTO kanban_boards (board_id, name, prefix, next_seq, scope_type, scope_id, columns_json, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(board_id, input.name, prefix, input.scope_type, input.scope_id, JSON.stringify(columns), ts, ts);
      return true;
    });
    return { board_id, name: input.name, prefix, next_seq: 1, scope_type: input.scope_type, scope_id: input.scope_id, columns, created_at: ts, updated_at: ts };
  }

  async get_board(board_id: string): Promise<KanbanBoard | null> {
    await this.initialized;
    const row = this.db((db) =>
      db.prepare("SELECT * FROM kanban_boards WHERE board_id = ?").get(board_id) as BoardRow | undefined,
    );
    return row ? row_to_board(row) : null;
  }

  async list_boards(scope_type?: ScopeType, scope_id?: string): Promise<KanbanBoard[]> {
    await this.initialized;
    const rows = this.db((db) => {
      if (scope_type && scope_id) {
        return db.prepare("SELECT * FROM kanban_boards WHERE scope_type = ? AND scope_id = ? ORDER BY updated_at DESC").all(scope_type, scope_id) as BoardRow[];
      }
      if (scope_type) {
        return db.prepare("SELECT * FROM kanban_boards WHERE scope_type = ? ORDER BY updated_at DESC").all(scope_type) as BoardRow[];
      }
      return db.prepare("SELECT * FROM kanban_boards ORDER BY updated_at DESC").all() as BoardRow[];
    }) ?? [];
    return rows.map(row_to_board);
  }

  async update_board(board_id: string, updates: { name?: string; columns?: KanbanColumnDef[] }): Promise<KanbanBoard | null> {
    await this.initialized;
    const ts = now_iso();
    this.db((db) => {
      const sets: string[] = ["updated_at = ?"];
      const params: unknown[] = [ts];
      if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
      if (updates.columns !== undefined) { sets.push("columns_json = ?"); params.push(JSON.stringify(updates.columns)); }
      params.push(board_id);
      db.prepare(`UPDATE kanban_boards SET ${sets.join(", ")} WHERE board_id = ?`).run(...params);
      return true;
    });
    return this.get_board(board_id);
  }

  async delete_board(board_id: string): Promise<boolean> {
    await this.initialized;
    const changes = this.db((db) => {
      const r = db.prepare("DELETE FROM kanban_boards WHERE board_id = ?").run(board_id);
      return Number(r.changes || 0);
    });
    return (changes ?? 0) > 0;
  }

  /* ═══ Card ═══ */

  async create_card(input: CreateCardInput): Promise<KanbanCard> {
    await this.initialized;
    const ts = now_iso();
    const column_id = input.column_id ?? "todo";
    const priority = input.priority ?? "none";
    const labels = input.labels ?? [];
    const metadata = input.metadata ?? {};

    const result = this.db((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const board = db.prepare("SELECT * FROM kanban_boards WHERE board_id = ?").get(input.board_id) as BoardRow | undefined;
        if (!board) throw new Error(`board_not_found: ${input.board_id}`);

        const seq = board.next_seq;
        const card_id = `${board.prefix}-${seq}`;
        db.prepare("UPDATE kanban_boards SET next_seq = next_seq + 1, updated_at = ? WHERE board_id = ?").run(ts, input.board_id);

        const max_pos = (db.prepare("SELECT COALESCE(MAX(position), -1) AS mp FROM kanban_cards WHERE board_id = ? AND column_id = ?").get(input.board_id, column_id) as { mp: number }).mp;

        db.prepare(`
          INSERT INTO kanban_cards (card_id, seq, board_id, title, description, column_id, position, priority, labels_json, assignee, created_by, task_id, due_date, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(card_id, seq, input.board_id, input.title, input.description ?? "", column_id, max_pos + 1, priority, JSON.stringify(labels), input.assignee ?? null, input.created_by, input.task_id ?? null, input.due_date ?? null, JSON.stringify(metadata), ts, ts);

        if (input.parent_id) {
          const rel_id = randomUUID();
          const inv_id = randomUUID();
          db.prepare("INSERT INTO kanban_relations (relation_id, source_card_id, target_card_id, type) VALUES (?, ?, ?, ?)").run(rel_id, input.parent_id, card_id, "parent_of");
          db.prepare("INSERT INTO kanban_relations (relation_id, source_card_id, target_card_id, type) VALUES (?, ?, ?, ?)").run(inv_id, card_id, input.parent_id, "child_of");
        }

        db.exec("COMMIT");
        return { card_id, seq };
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* no-op */ }
        throw e;
      }
    });

    if (!result) throw new Error("create_card_failed");
    const card: KanbanCard = {
      card_id: result.card_id, seq: result.seq, board_id: input.board_id,
      title: input.title, description: input.description ?? "", column_id, position: 0,
      priority, labels, assignee: input.assignee, created_by: input.created_by,
      task_id: input.task_id, due_date: input.due_date, metadata, comment_count: 0, created_at: ts, updated_at: ts,
    };
    this.log_activity(card.card_id, input.board_id, input.created_by, "created", { title: input.title, column_id }).catch(() => {});
    return card;
  }

  async get_card(card_id: string): Promise<KanbanCard | null> {
    await this.initialized;
    const result = this.db((db) => {
      const row = db.prepare("SELECT * FROM kanban_cards WHERE card_id = ?").get(card_id) as CardRow | undefined;
      if (!row) return null;
      const count = (db.prepare("SELECT COUNT(*) AS c FROM kanban_comments WHERE card_id = ?").get(card_id) as { c: number }).c;
      return row_to_card(row, count);
    });
    return result ?? null;
  }

  async get_card_by_readable_id(readable_id: string): Promise<KanbanCard | null> {
    return this.get_card(readable_id);
  }

  async list_cards(board_id: string, column_id?: string, limit?: number, assignee?: string): Promise<KanbanCard[]> {
    await this.initialized;
    const rows = this.db((db) => {
      let sql = `
        SELECT c.*, COALESCE(cc.cnt, 0) AS comment_count
        FROM kanban_cards c
        LEFT JOIN (SELECT card_id, COUNT(*) AS cnt FROM kanban_comments GROUP BY card_id) cc ON cc.card_id = c.card_id
        WHERE c.board_id = ?
      `;
      const params: unknown[] = [board_id];
      if (column_id) { sql += " AND c.column_id = ?"; params.push(column_id); }
      if (assignee) { sql += " AND c.assignee = ?"; params.push(assignee); }
      sql += " ORDER BY c.column_id, c.position ASC";
      if (limit) { sql += " LIMIT ?"; params.push(limit); }
      return db.prepare(sql).all(...params) as Array<CardRow & { comment_count: number }>;
    }) ?? [];
    return rows.map(r => row_to_card(r, r.comment_count));
  }

  async move_card(card_id: string, column_id: string, position?: number, actor?: string): Promise<KanbanCard | null> {
    await this.initialized;
    const ts = now_iso();
    const move_info = this.db((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const card = db.prepare("SELECT * FROM kanban_cards WHERE card_id = ?").get(card_id) as CardRow | undefined;
        if (!card) { db.exec("ROLLBACK"); return null; }

        const from_col = card.column_id;
        const max_pos = (db.prepare("SELECT COALESCE(MAX(position), -1) AS mp FROM kanban_cards WHERE board_id = ? AND column_id = ?").get(card.board_id, column_id) as { mp: number }).mp;
        const target_pos = position ?? (max_pos + 1);

        db.prepare("UPDATE kanban_cards SET position = position + 1 WHERE board_id = ? AND column_id = ? AND position >= ?").run(card.board_id, column_id, target_pos);
        db.prepare("UPDATE kanban_cards SET column_id = ?, position = ?, updated_at = ? WHERE card_id = ?").run(column_id, target_pos, ts, card_id);

        db.exec("COMMIT");
        return { board_id: card.board_id, from: from_col, to: column_id };
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* no-op */ }
        throw e;
      }
    });
    if (move_info) {
      this.log_activity(card_id, move_info.board_id, actor || "system", "moved", { from: move_info.from, to: move_info.to }).catch(() => {});
    }
    return this.get_card(card_id);
  }

  async update_card(card_id: string, updates: UpdateCardInput): Promise<KanbanCard | null> {
    await this.initialized;
    const ts = now_iso();
    const board_id = this.db((db) => {
      const card = db.prepare("SELECT board_id, priority, assignee FROM kanban_cards WHERE card_id = ?").get(card_id) as { board_id: string; priority: string; assignee: string | null } | undefined;
      if (!card) return null;
      const sets: string[] = ["updated_at = ?"];
      const params: unknown[] = [ts];
      if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
      if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
      if (updates.priority !== undefined) { sets.push("priority = ?"); params.push(updates.priority); }
      if (updates.labels !== undefined) { sets.push("labels_json = ?"); params.push(JSON.stringify(updates.labels)); }
      if (updates.assignee !== undefined) { sets.push("assignee = ?"); params.push(updates.assignee); }
      if (updates.task_id !== undefined) { sets.push("task_id = ?"); params.push(updates.task_id); }
      if (updates.due_date !== undefined) { sets.push("due_date = ?"); params.push(updates.due_date); }
      if (updates.metadata !== undefined) { sets.push("metadata_json = ?"); params.push(JSON.stringify(updates.metadata)); }
      params.push(card_id);
      db.prepare(`UPDATE kanban_cards SET ${sets.join(", ")} WHERE card_id = ?`).run(...params);
      return card.board_id;
    });
    if (board_id) {
      const detail: Record<string, unknown> = {};
      if (updates.priority !== undefined) detail.priority = updates.priority;
      if (updates.assignee !== undefined) detail.assignee = updates.assignee;
      if (updates.labels !== undefined) detail.labels = updates.labels;
      if (updates.due_date !== undefined) detail.due_date = updates.due_date;
      const action: ActivityAction = updates.due_date !== undefined ? "due_date_set"
        : updates.priority !== undefined ? "priority_changed"
        : updates.assignee !== undefined ? "assigned"
        : updates.labels !== undefined ? "labels_changed"
        : "updated";
      this.log_activity(card_id, board_id, updates.actor || "system", action, detail).catch(() => {});
    }
    return this.get_card(card_id);
  }

  async delete_card(card_id: string): Promise<boolean> {
    await this.initialized;
    const info = this.db((db) => {
      const card = db.prepare("SELECT board_id, title FROM kanban_cards WHERE card_id = ?").get(card_id) as { board_id: string; title: string } | undefined;
      if (!card) return null;
      db.prepare("DELETE FROM kanban_cards WHERE card_id = ?").run(card_id);
      return card;
    });
    if (info) {
      this.log_activity(card_id, info.board_id, "system", "archived", { title: info.title }).catch(() => {});
    }
    return info !== null;
  }

  /* ═══ Comment ═══ */

  async add_comment(card_id: string, author: string, text: string): Promise<KanbanComment> {
    await this.initialized;
    const comment_id = randomUUID();
    const ts = now_iso();
    const board_id = this.db((db) => {
      db.prepare("INSERT INTO kanban_comments (comment_id, card_id, author, text, created_at) VALUES (?, ?, ?, ?, ?)").run(comment_id, card_id, author, text, ts);
      db.prepare("UPDATE kanban_cards SET updated_at = ? WHERE card_id = ?").run(ts, card_id);
      const card = db.prepare("SELECT board_id FROM kanban_cards WHERE card_id = ?").get(card_id) as { board_id: string } | undefined;
      return card?.board_id ?? null;
    });
    if (board_id) {
      this.log_activity(card_id, board_id, author, "commented", { text: text.slice(0, 100) }).catch(() => {});
    }
    return { comment_id, card_id, author, text, created_at: ts };
  }

  async list_comments(card_id: string, limit?: number): Promise<KanbanComment[]> {
    await this.initialized;
    const rows = this.db((db) => {
      let sql = "SELECT * FROM kanban_comments WHERE card_id = ? ORDER BY created_at ASC";
      const params: unknown[] = [card_id];
      if (limit) { sql += " LIMIT ?"; params.push(limit); }
      return db.prepare(sql).all(...params) as CommentRow[];
    }) ?? [];
    return rows.map(row_to_comment);
  }

  /* ═══ Relation ═══ */

  async add_relation(source_card_id: string, target_card_id: string, type: RelationType): Promise<KanbanRelation> {
    await this.initialized;
    const relation_id = randomUUID();
    const board_id = this.db((db) => {
      db.prepare("INSERT OR IGNORE INTO kanban_relations (relation_id, source_card_id, target_card_id, type) VALUES (?, ?, ?, ?)").run(relation_id, source_card_id, target_card_id, type);
      const card = db.prepare("SELECT board_id FROM kanban_cards WHERE card_id = ?").get(source_card_id) as { board_id: string } | undefined;
      return card?.board_id ?? null;
    });
    if (board_id) {
      this.log_activity(source_card_id, board_id, "system", "relation_added", { target: target_card_id, type }).catch(() => {});
    }
    return { relation_id, source_card_id, target_card_id, type };
  }

  async remove_relation(relation_id: string): Promise<boolean> {
    await this.initialized;
    const info = this.db((db) => {
      const rel = db.prepare("SELECT * FROM kanban_relations WHERE relation_id = ?").get(relation_id) as RelationRow | undefined;
      if (!rel) return null;
      db.prepare("DELETE FROM kanban_relations WHERE relation_id = ?").run(relation_id);
      const card = db.prepare("SELECT board_id FROM kanban_cards WHERE card_id = ?").get(rel.source_card_id) as { board_id: string } | undefined;
      return { source: rel.source_card_id, target: rel.target_card_id, type: rel.type, board_id: card?.board_id ?? null };
    });
    if (info?.board_id) {
      this.log_activity(info.source, info.board_id, "system", "relation_removed", { target: info.target, type: info.type }).catch(() => {});
    }
    return info !== null;
  }

  async list_relations(card_id: string): Promise<KanbanRelation[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare("SELECT * FROM kanban_relations WHERE source_card_id = ? OR target_card_id = ?").all(card_id, card_id) as RelationRow[],
    ) ?? [];
    return rows.map(row_to_relation);
  }

  /* ═══ Query ═══ */

  async get_subtasks(parent_card_id: string): Promise<KanbanCard[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare(`
        SELECT c.*, COALESCE(cc.cnt, 0) AS comment_count
        FROM kanban_cards c
        LEFT JOIN (SELECT card_id, COUNT(*) AS cnt FROM kanban_comments GROUP BY card_id) cc ON cc.card_id = c.card_id
        INNER JOIN kanban_relations r ON r.target_card_id = c.card_id
        WHERE r.source_card_id = ? AND r.type = 'parent_of'
        ORDER BY c.seq ASC
      `).all(parent_card_id) as Array<CardRow & { comment_count: number }>,
    ) ?? [];
    return rows.map(r => row_to_card(r, r.comment_count));
  }

  async board_summary(board_id: string): Promise<BoardSummary | null> {
    await this.initialized;
    const board = await this.get_board(board_id);
    if (!board) return null;

    const result = this.db((db) => {
      const counts = db.prepare("SELECT column_id, COUNT(*) AS cnt FROM kanban_cards WHERE board_id = ? GROUP BY column_id").all(board_id) as Array<{ column_id: string; cnt: number }>;
      const count_map = new Map(counts.map(c => [c.column_id, c.cnt]));

      const total = counts.reduce((s, c) => s + c.cnt, 0);
      const done = count_map.get("done") ?? 0;

      const blockers = db.prepare(`
        SELECT c.card_id, c.title, GROUP_CONCAT(r.target_card_id) AS blocked_by_ids
        FROM kanban_cards c
        INNER JOIN kanban_relations r ON r.source_card_id = c.card_id AND r.type = 'blocked_by'
        WHERE c.board_id = ? AND c.column_id != 'done'
        GROUP BY c.card_id
      `).all(board_id) as Array<{ card_id: string; title: string; blocked_by_ids: string }>;

      const today = now_iso().slice(0, 10);
      const overdue = db.prepare(`
        SELECT card_id, title, due_date, column_id FROM kanban_cards
        WHERE board_id = ? AND due_date IS NOT NULL AND due_date < ? AND column_id != 'done'
        ORDER BY due_date ASC
      `).all(board_id, today) as Array<{ card_id: string; title: string; due_date: string; column_id: string }>;

      return {
        columns: board.columns.map(col => ({ id: col.id, name: col.name, color: col.color, count: count_map.get(col.id) ?? 0 })),
        total,
        done,
        blockers: blockers.map(b => ({ card_id: b.card_id, title: b.title, blocked_by: b.blocked_by_ids.split(",") })),
        overdue,
      };
    });

    if (!result) return null;
    return { board_id, name: board.name, ...result };
  }

  async get_participants(card_id: string): Promise<string[]> {
    await this.initialized;
    const actors = this.db((db) => {
      const card = db.prepare("SELECT created_by, assignee FROM kanban_cards WHERE card_id = ?").get(card_id) as { created_by: string; assignee: string | null } | undefined;
      if (!card) return [];
      const commenters = db.prepare("SELECT DISTINCT author FROM kanban_comments WHERE card_id = ?").all(card_id) as Array<{ author: string }>;
      const set = new Set<string>();
      set.add(card.created_by);
      if (card.assignee) set.add(card.assignee);
      for (const c of commenters) set.add(c.author);
      return [...set];
    });
    return actors ?? [];
  }

  async get_subtask_counts(board_id: string): Promise<Map<string, { total: number; done: number }>> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare(`
        SELECT r.source_card_id AS parent_id,
               COUNT(*) AS total,
               SUM(CASE WHEN c.column_id = 'done' THEN 1 ELSE 0 END) AS done
        FROM kanban_relations r
        INNER JOIN kanban_cards c ON c.card_id = r.target_card_id
        WHERE r.type = 'parent_of' AND c.board_id = ?
        GROUP BY r.source_card_id
      `).all(board_id) as Array<{ parent_id: string; total: number; done: number }>,
    ) ?? [];
    return new Map(rows.map(r => [r.parent_id, { total: r.total, done: r.done }]));
  }

  /* ═══ Activity ═══ */

  async log_activity(card_id: string, board_id: string, actor: string, action: ActivityAction, detail?: Record<string, unknown>): Promise<KanbanActivity> {
    await this.initialized;
    const activity_id = randomUUID();
    const ts = now_iso();
    this.db((db) => {
      db.prepare("INSERT INTO kanban_activities (activity_id, card_id, board_id, actor, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(activity_id, card_id, board_id, actor, action, JSON.stringify(detail ?? {}), ts);
      return true;
    });
    const activity: KanbanActivity = { activity_id, card_id, board_id, actor, action, detail: detail ?? {}, created_at: ts };
    this.emitter.emit(`board:${board_id}`, { type: "activity", board_id, data: activity } satisfies KanbanEvent);
    return activity;
  }

  async list_activities(opts: { card_id?: string; board_id?: string; limit?: number }): Promise<KanbanActivity[]> {
    await this.initialized;
    const rows = this.db((db) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.card_id) { where.push("card_id = ?"); params.push(opts.card_id); }
      if (opts.board_id) { where.push("board_id = ?"); params.push(opts.board_id); }
      let sql = "SELECT * FROM kanban_activities";
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY created_at DESC";
      if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
      return db.prepare(sql).all(...params) as ActivityRow[];
    }) ?? [];
    return rows.map(row_to_activity);
  }

  /* ═══ Rules ═══ */

  async add_rule(input: { board_id: string; trigger: KanbanRule["trigger"]; condition: Record<string, unknown>; action_type: KanbanRule["action_type"]; action_params: Record<string, unknown> }): Promise<KanbanRule> {
    await this.initialized;
    const rule_id = randomUUID();
    const ts = now_iso();
    this.db((db) => {
      db.prepare("INSERT INTO kanban_rules (rule_id, board_id, trigger, condition_json, action_type, action_params_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
        .run(rule_id, input.board_id, input.trigger, JSON.stringify(input.condition), input.action_type, JSON.stringify(input.action_params), ts);
      return true;
    });
    return { rule_id, board_id: input.board_id, trigger: input.trigger, condition: input.condition, action_type: input.action_type, action_params: input.action_params, enabled: true, created_at: ts };
  }

  async list_rules(board_id: string): Promise<KanbanRule[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare("SELECT * FROM kanban_rules WHERE board_id = ? ORDER BY created_at ASC").all(board_id) as RuleRow[],
    ) ?? [];
    return rows.map(row_to_rule);
  }

  async update_rule(rule_id: string, updates: { enabled?: boolean; condition?: Record<string, unknown>; action_params?: Record<string, unknown> }): Promise<KanbanRule | null> {
    await this.initialized;
    this.db((db) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (updates.enabled !== undefined) { sets.push("enabled = ?"); params.push(updates.enabled ? 1 : 0); }
      if (updates.condition !== undefined) { sets.push("condition_json = ?"); params.push(JSON.stringify(updates.condition)); }
      if (updates.action_params !== undefined) { sets.push("action_params_json = ?"); params.push(JSON.stringify(updates.action_params)); }
      if (!sets.length) return null;
      params.push(rule_id);
      db.prepare(`UPDATE kanban_rules SET ${sets.join(", ")} WHERE rule_id = ?`).run(...params);
      return true;
    });
    const row = this.db((db) => db.prepare("SELECT * FROM kanban_rules WHERE rule_id = ?").get(rule_id) as RuleRow | undefined);
    return row ? row_to_rule(row) : null;
  }

  async remove_rule(rule_id: string): Promise<boolean> {
    await this.initialized;
    const changes = this.db((db) => {
      const r = db.prepare("DELETE FROM kanban_rules WHERE rule_id = ?").run(rule_id);
      return Number(r.changes || 0);
    });
    return (changes ?? 0) > 0;
  }

  async get_rules_by_trigger(board_id: string, trigger: KanbanRule["trigger"]): Promise<KanbanRule[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare("SELECT * FROM kanban_rules WHERE board_id = ? AND trigger = ? AND enabled = 1 ORDER BY created_at ASC").all(board_id, trigger) as RuleRow[],
    ) ?? [];
    return rows.map(row_to_rule);
  }

  /* ═══ Templates ═══ */

  async create_template(input: { name: string; description?: string; columns?: KanbanColumnDef[]; cards: KanbanTemplate["cards"] }): Promise<KanbanTemplate> {
    await this.initialized;
    const template_id = randomUUID();
    const ts = now_iso();
    this.db((db) => {
      db.prepare("INSERT INTO kanban_templates (template_id, name, description, columns_json, cards_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(template_id, input.name, input.description ?? "", input.columns ? JSON.stringify(input.columns) : null, JSON.stringify(input.cards), ts);
      return true;
    });
    return { template_id, name: input.name, description: input.description ?? "", columns: input.columns, cards: input.cards, created_at: ts };
  }

  async list_templates(): Promise<KanbanTemplate[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare("SELECT * FROM kanban_templates ORDER BY name ASC").all() as TemplateRow[],
    ) ?? [];
    return rows.map(row_to_template);
  }

  async get_template(template_id_or_name: string): Promise<KanbanTemplate | null> {
    await this.initialized;
    const row = this.db((db) =>
      db.prepare("SELECT * FROM kanban_templates WHERE template_id = ? OR name = ?").get(template_id_or_name, template_id_or_name) as TemplateRow | undefined,
    );
    return row ? row_to_template(row) : null;
  }

  async delete_template(template_id: string): Promise<boolean> {
    await this.initialized;
    const changes = this.db((db) => {
      const r = db.prepare("DELETE FROM kanban_templates WHERE template_id = ?").run(template_id);
      return Number(r.changes || 0);
    });
    return (changes ?? 0) > 0;
  }

  /* ═══ Metrics ═══ */

  async get_board_metrics(board_id: string, days = 30): Promise<BoardMetrics | null> {
    await this.initialized;
    const board = await this.get_board(board_id);
    if (!board) return null;

    const result = this.db((db) => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      /* 기간 내 done 컬럼으로 이동된 카드 수 (throughput) */
      const throughput_row = db.prepare(`
        SELECT COUNT(DISTINCT card_id) AS cnt FROM kanban_activities
        WHERE board_id = ? AND action = 'moved' AND json_extract(detail_json, '$.to') = 'done' AND created_at >= ?
      `).get(board_id, since) as { cnt: number };

      /* 평균 사이클 타임: created → done (시간 단위) */
      const cycle_row = db.prepare(`
        SELECT AVG(
          (julianday(a.created_at) - julianday(c.created_at)) * 24
        ) AS avg_hours
        FROM kanban_activities a
        INNER JOIN kanban_cards c ON c.card_id = a.card_id
        WHERE a.board_id = ? AND a.action = 'moved' AND json_extract(a.detail_json, '$.to') = 'done' AND a.created_at >= ?
      `).get(board_id, since) as { avg_hours: number | null };

      /* 컬럼별 카드 수 */
      const col_rows = db.prepare("SELECT column_id, COUNT(*) AS cnt FROM kanban_cards WHERE board_id = ? GROUP BY column_id").all(board_id) as Array<{ column_id: string; cnt: number }>;
      const cards_by_column: Record<string, number> = {};
      for (const r of col_rows) cards_by_column[r.column_id] = r.cnt;

      /* 우선순위별 카드 수 */
      const pri_rows = db.prepare("SELECT priority, COUNT(*) AS cnt FROM kanban_cards WHERE board_id = ? GROUP BY priority").all(board_id) as Array<{ priority: string; cnt: number }>;
      const cards_by_priority: Record<string, number> = {};
      for (const r of pri_rows) cards_by_priority[r.priority] = r.cnt;

      /* 주간 완료 벨로시티 (최근 N주) */
      const weeks = Math.ceil(days / 7);
      const vel_rows = db.prepare(`
        SELECT strftime('%Y-W%W', created_at) AS week, COUNT(DISTINCT card_id) AS done
        FROM kanban_activities
        WHERE board_id = ? AND action = 'moved' AND json_extract(detail_json, '$.to') = 'done' AND created_at >= ?
        GROUP BY week ORDER BY week ASC
      `).all(board_id, since) as Array<{ week: string; done: number }>;

      return {
        throughput: throughput_row.cnt,
        avg_cycle_time_hours: Math.round((cycle_row.avg_hours ?? 0) * 100) / 100,
        cards_by_column,
        cards_by_priority,
        velocity: vel_rows.slice(-weeks),
      };
    });

    if (!result) return null;
    return { board_id, period_days: days, ...result };
  }

  /* ═══ Time Tracking ═══ */

  async get_card_time_tracking(card_id: string): Promise<CardTimeTracking | null> {
    await this.initialized;
    const card = await this.get_card(card_id);
    if (!card) return null;

    const activities = await this.list_activities({ card_id });
    const moved = activities
      .filter(a => a.action === "moved")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    const times: ColumnDwellTime[] = [];
    const created_activity = activities.find(a => a.action === "created");
    const initial_col = (created_activity?.detail?.column_id as string) ?? card.column_id;
    const initial_entered = card.created_at;

    if (moved.length === 0) {
      const hours = (Date.now() - new Date(initial_entered).getTime()) / 3600_000;
      times.push({ column_id: initial_col, entered_at: initial_entered, duration_hours: Math.round(hours * 100) / 100 });
    } else {
      /* 첫 이동 전 초기 컬럼 */
      const first_move_at = moved[0].created_at;
      const h0 = (new Date(first_move_at).getTime() - new Date(initial_entered).getTime()) / 3600_000;
      times.push({ column_id: initial_col, entered_at: initial_entered, exited_at: first_move_at, duration_hours: Math.round(h0 * 100) / 100 });

      for (let i = 0; i < moved.length; i++) {
        const m = moved[i];
        const to_col = (m.detail?.to as string) ?? "unknown";
        const entered = m.created_at;
        const exited = i + 1 < moved.length ? moved[i + 1].created_at : undefined;
        const end = exited ? new Date(exited).getTime() : Date.now();
        const h = (end - new Date(entered).getTime()) / 3600_000;
        times.push({ column_id: to_col, entered_at: entered, exited_at: exited, duration_hours: Math.round(h * 100) / 100 });
      }
    }

    const total = times.reduce((s, t) => s + t.duration_hours, 0);
    return { card_id, total_hours: Math.round(total * 100) / 100, column_times: times };
  }

  /* ═══ Search ═══ */

  async search_cards(query: string, opts?: { board_id?: string; limit?: number }): Promise<SearchResult[]> {
    await this.initialized;
    const q = query.trim();
    if (!q) return [];
    const limit = opts?.limit ?? 20;

    const rows = this.db((db) => {
      const like = `%${q}%`;
      let sql = `
        SELECT c.card_id, c.board_id, b.name AS board_name, c.title, c.description, c.column_id, c.priority,
               CASE
                 WHEN c.card_id = ? THEN 100
                 WHEN c.title LIKE ? THEN 50
                 ELSE 10
               END AS score
        FROM kanban_cards c
        INNER JOIN kanban_boards b ON b.board_id = c.board_id
        WHERE (c.card_id = ? OR c.title LIKE ? OR c.description LIKE ? OR c.labels_json LIKE ?)
      `;
      const params: unknown[] = [q, like, q, like, like, like];
      if (opts?.board_id) { sql += " AND c.board_id = ?"; params.push(opts.board_id); }
      sql += " ORDER BY score DESC, c.updated_at DESC LIMIT ?";
      params.push(limit);
      return db.prepare(sql).all(...params) as Array<{
        card_id: string; board_id: string; board_name: string;
        title: string; description: string; column_id: string; priority: string; score: number;
      }>;
    }) ?? [];

    return rows.map(r => ({
      card_id: r.card_id,
      board_id: r.board_id,
      board_name: r.board_name,
      title: r.title,
      description_snippet: r.description.slice(0, 100),
      column_id: r.column_id,
      priority: r.priority as Priority,
      score: r.score,
    }));
  }

  /* ═══ Filters ═══ */

  async save_filter(input: { board_id: string; name: string; criteria: FilterCriteria; created_by?: string }): Promise<KanbanFilter> {
    await this.initialized;
    const filter_id = randomUUID();
    const ts = now_iso();
    this.db((db) => {
      db.prepare("INSERT INTO kanban_filters (filter_id, board_id, name, criteria_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(filter_id, input.board_id, input.name, JSON.stringify(input.criteria), input.created_by ?? "user:dashboard", ts);
      return true;
    });
    return { filter_id, board_id: input.board_id, name: input.name, criteria: input.criteria, created_by: input.created_by ?? "user:dashboard", created_at: ts };
  }

  async list_filters(board_id: string): Promise<KanbanFilter[]> {
    await this.initialized;
    const rows = this.db((db) =>
      db.prepare("SELECT * FROM kanban_filters WHERE board_id = ? ORDER BY name ASC").all(board_id) as FilterRow[],
    ) ?? [];
    return rows.map(row_to_filter);
  }

  async delete_filter(filter_id: string): Promise<boolean> {
    await this.initialized;
    const changes = this.db((db) => {
      const r = db.prepare("DELETE FROM kanban_filters WHERE filter_id = ?").run(filter_id);
      return Number(r.changes || 0);
    });
    return (changes ?? 0) > 0;
  }

  /* ═══ Event Stream ═══ */

  subscribe(board_id: string, listener: KanbanEventListener): void {
    this.emitter.on(`board:${board_id}`, listener);
  }

  unsubscribe(board_id: string, listener: KanbanEventListener): void {
    this.emitter.off(`board:${board_id}`, listener);
  }
}
