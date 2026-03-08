/** 칸반 보드 에이전트 도구 — 작업 분해·추적·협업. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import type { KanbanStoreLike, RelationType, ScopeType, Priority, KanbanRule } from "../../services/kanban-store.js";
import type { KanbanRuleExecutor } from "../../services/kanban-rule-executor.js";

const ACTIONS = [
  "create_board", "update_board", "list_boards",
  "create_card", "move_card", "update_card", "archive_card",
  "list_cards", "get_card", "board_summary",
  "comment", "list_comments",
  "add_relation", "remove_relation",
  "list_activities",
  "add_rule", "list_rules", "remove_rule", "toggle_rule",
  "create_template", "list_templates", "create_board_from_template", "delete_template",
  "board_metrics",
  "card_time_tracking", "search",
  "save_filter", "list_filters", "delete_filter",
] as const;

type Action = typeof ACTIONS[number];

export class KanbanTool extends Tool {
  readonly name = "kanban";
  readonly category = "admin" as const;
  readonly policy_flags = { write: true, network: false };

  readonly description = [
    "칸반 보드를 통해 작업을 분해·추적·협업합니다.",
    "액션: " + ACTIONS.join(", "),
    "",
    "카드 ID는 보드 prefix + 순번 (예: ISS-1, KB-42). 서브태스크는 parent_id로 생성.",
    "create_board → create_card → move_card → comment → board_summary 흐름으로 사용.",
  ].join("\n");

  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: [...ACTIONS] },
      /* board */
      name: { type: "string", description: "보드 이름 (create_board, update_board)" },
      scope_type: { type: "string", enum: ["channel", "session", "workflow"], description: "보드 범위 타입" },
      scope_id: { type: "string", description: "보드 범위 ID" },
      columns: { type: "array", description: "커스텀 컬럼 [{id, name, color}]" },
      /* card */
      board_id: { type: "string", description: "보드 ID (update_board, create_card, list_cards 등)" },
      card_id: { type: "string", description: "카드 ID — 예: ISS-3 (move_card, update_card, get_card 등)" },
      title: { type: "string", description: "카드 제목" },
      description: { type: "string", description: "카드 설명 (마크다운)" },
      column_id: { type: "string", description: "컬럼 ID: todo, in_progress, in_review, done" },
      position: { type: "integer", description: "컬럼 내 위치 (0-based)" },
      priority: { type: "string", enum: ["urgent", "high", "medium", "low", "none"] },
      labels: { type: "array", items: { type: "string" }, description: "라벨 (예: [\"ui:#3498db\", \"bug:#e74c3c\"])" },
      assignee: { type: "string", description: "담당자 (agent_id 또는 \"user\")" },
      parent_id: { type: "string", description: "부모 카드 ID — 서브태스크 생성 시" },
      metadata: { type: "object", description: "확장 메타데이터 (예: {files, branch, pr_url})" },
      /* comment */
      text: { type: "string", description: "코멘트 텍스트" },
      /* relation */
      source_card_id: { type: "string", description: "관계 출발 카드 ID" },
      target_card_id: { type: "string", description: "관계 대상 카드 ID" },
      type: { type: "string", enum: ["blocked_by", "blocks", "related_to", "parent_of", "child_of"] },
      relation_id: { type: "string", description: "관계 ID (remove_relation)" },
      /* rule */
      trigger: { type: "string", enum: ["card_moved", "subtasks_done", "card_stale"], description: "규칙 트리거" },
      condition: { type: "object", description: "규칙 조건 (예: {to_column: 'done'})" },
      action_type: { type: "string", enum: ["move_card", "assign", "add_label", "comment", "run_workflow", "create_task"], description: "규칙 실행 액션" },
      action_params: { type: "object", description: "규칙 액션 파라미터" },
      rule_id: { type: "string", description: "규칙 ID (remove_rule, toggle_rule)" },
      enabled: { type: "boolean", description: "규칙 활성화 여부 (toggle_rule)" },
      /* template */
      template_id: { type: "string", description: "템플릿 ID (delete_template)" },
      template_name: { type: "string", description: "템플릿 이름 (create_board_from_template)" },
      cards: { type: "array", description: "템플릿 초기 카드 [{title, description?, column_id?, priority?, labels?}]" },
      /* due date */
      due_date: { type: "string", description: "기한 (ISO 날짜, 예: 2026-03-15). null로 클리어" },
      /* metrics */
      days: { type: "integer", minimum: 1, maximum: 365, description: "메트릭스 기간 (일)" },
      /* search */
      query: { type: "string", description: "검색 쿼리 (search)" },
      /* filter */
      filter_id: { type: "string", description: "필터 ID (delete_filter)" },
      criteria: { type: "object", description: "필터 조건 {column_ids?, priority?, assignee?, labels?, overdue?}" },
      /* shared */
      limit: { type: "integer", minimum: 1, maximum: 200, description: "결과 수 제한" },
    },
  };

  private readonly store: KanbanStoreLike;
  private rule_executor?: KanbanRuleExecutor;

  constructor(store: KanbanStoreLike) {
    super();
    this.store = store;
  }

  /** Rule executor 주입 — rule 생성/활성화 시 동적 watch 활성화. */
  set_rule_executor(executor: KanbanRuleExecutor): void {
    this.rule_executor = executor;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "").trim() as Action;
    const agent_id = context?.sender_id ?? "agent";

    try {
      switch (action) {
        case "create_board": return await this.handle_create_board(params);
        case "update_board": return await this.handle_update_board(params);
        case "list_boards": return await this.handle_list_boards(params);
        case "create_card": return await this.handle_create_card(params, agent_id);
        case "move_card": return await this.handle_move_card(params, agent_id);
        case "update_card": return await this.handle_update_card(params, agent_id);
        case "archive_card": return await this.handle_archive_card(params);
        case "list_cards": return await this.handle_list_cards(params);
        case "get_card": return await this.handle_get_card(params);
        case "board_summary": return await this.handle_board_summary(params);
        case "comment": return await this.handle_comment(params, agent_id);
        case "list_comments": return await this.handle_list_comments(params);
        case "add_relation": return await this.handle_add_relation(params);
        case "remove_relation": return await this.handle_remove_relation(params);
        case "list_activities": return await this.handle_list_activities(params);
        case "add_rule": return await this.handle_add_rule(params);
        case "list_rules": return await this.handle_list_rules(params);
        case "remove_rule": return await this.handle_remove_rule(params);
        case "toggle_rule": return await this.handle_toggle_rule(params);
        case "create_template": return await this.handle_create_template(params);
        case "list_templates": return await this.handle_list_templates();
        case "create_board_from_template": return await this.handle_create_board_from_template(params);
        case "delete_template": return await this.handle_delete_template(params);
        case "board_metrics": return await this.handle_board_metrics(params);
        case "card_time_tracking": return await this.handle_card_time_tracking(params);
        case "search": return await this.handle_search(params);
        case "save_filter": return await this.handle_save_filter(params, agent_id);
        case "list_filters": return await this.handle_list_filters(params);
        case "delete_filter": return await this.handle_delete_filter(params);
        default: return `Error: unknown action "${action}". Use one of: ${ACTIONS.join(", ")}`;
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /* ─── action handlers ─── */

  private async handle_create_board(p: Record<string, unknown>): Promise<string> {
    const name = str(p.name);
    if (!name) return "Error: name is required";
    const scope_type = str(p.scope_type) as ScopeType;
    const scope_id = str(p.scope_id);
    if (!scope_type || !scope_id) return "Error: scope_type and scope_id are required";

    // 동일 scope에 보드가 이미 있으면 기존 보드 반환 (goto 재실행 시 중복 방지)
    const existing = await this.store.list_boards(scope_type, scope_id);
    if (existing.length > 0) {
      const b = existing[0]!;
      return JSON.stringify({ ok: true, board_id: b.board_id, prefix: b.prefix, columns: b.columns.map(c => c.id), already_exists: true });
    }

    const columns = p.columns as Array<{ id: string; name: string; color: string }> | undefined;
    const board = await this.store.create_board({ name, scope_type, scope_id, columns });
    return JSON.stringify({ ok: true, board_id: board.board_id, prefix: board.prefix, columns: board.columns.map(c => c.id) });
  }

  private async handle_update_board(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const updates: { name?: string; columns?: import("../../services/kanban-store.js").KanbanColumnDef[] } = {};
    if (p.name) updates.name = str(p.name);
    if (p.columns) updates.columns = p.columns as import("../../services/kanban-store.js").KanbanColumnDef[];
    const board = await this.store.update_board(board_id, updates);
    if (!board) return `Error: board ${board_id} not found`;
    return JSON.stringify({ ok: true, board_id: board.board_id, name: board.name });
  }

  private async handle_list_boards(p: Record<string, unknown>): Promise<string> {
    const scope_type = str(p.scope_type) as ScopeType | undefined;
    const scope_id = str(p.scope_id);
    const boards = await this.store.list_boards(scope_type || undefined, scope_id || undefined);
    if (boards.length === 0) return "보드 없음";
    return boards.map(b => `[${b.board_id}] ${b.name} (${b.scope_type}:${b.scope_id}) prefix=${b.prefix}`).join("\n");
  }

  private async handle_create_card(p: Record<string, unknown>, agent_id: string): Promise<string> {
    const board_id = str(p.board_id);
    const title = str(p.title);
    if (!board_id || !title) return "Error: board_id and title are required";

    // 동일 보드에 같은 제목 카드가 이미 있으면 기존 카드 반환 (goto 재실행 시 중복 방지)
    const parent_id = str(p.parent_id) || undefined;
    const existing_cards = await this.store.list_cards(board_id, undefined, 500);
    const existing = existing_cards.find((c) => c.title === title);
    if (existing) {
      return `${existing.card_id} already exists: "${existing.title}" in ${existing.column_id}`;
    }

    const card = await this.store.create_card({
      board_id,
      title,
      description: str(p.description),
      column_id: str(p.column_id) || undefined,
      priority: str(p.priority) as Priority | undefined,
      labels: p.labels as string[] | undefined,
      assignee: str(p.assignee) || undefined,
      created_by: agent_id,
      parent_id,
      due_date: str(p.due_date) || undefined,
      task_id: str(p.task_id) || undefined,
      metadata: p.metadata as Record<string, unknown> | undefined,
    });
    const parent_note = parent_id ? ` (child of ${parent_id})` : "";
    return `${card.card_id} created${parent_note}: "${card.title}" in ${card.column_id}`;
  }

  private async handle_move_card(p: Record<string, unknown>, agent_id: string): Promise<string> {
    const card_id = str(p.card_id);
    const column_id = str(p.column_id);
    if (!card_id || !column_id) return "Error: card_id and column_id are required";
    const pos = typeof p.position === "number" ? p.position : undefined;
    const card = await this.store.move_card(card_id, column_id, pos, agent_id);
    if (!card) return `Error: card not found: ${card_id}`;
    return `${card_id} moved to ${column_id}`;
  }

  private async handle_update_card(p: Record<string, unknown>, agent_id: string): Promise<string> {
    const card_id = str(p.card_id);
    if (!card_id) return "Error: card_id is required";
    const card = await this.store.update_card(card_id, {
      title: str(p.title) || undefined,
      description: str(p.description) !== "" ? str(p.description) || undefined : undefined,
      priority: str(p.priority) as Priority | undefined,
      labels: p.labels as string[] | undefined,
      assignee: p.assignee !== undefined ? (str(p.assignee) || null) : undefined,
      due_date: p.due_date !== undefined ? (str(p.due_date) || null) : undefined,
      task_id: p.task_id !== undefined ? (str(p.task_id) || null) : undefined,
      metadata: p.metadata as Record<string, unknown> | undefined,
      actor: agent_id,
    });
    if (!card) return `Error: card not found: ${card_id}`;
    return `${card_id} updated`;
  }

  private async handle_archive_card(p: Record<string, unknown>): Promise<string> {
    const card_id = str(p.card_id);
    if (!card_id) return "Error: card_id is required";
    const ok = await this.store.delete_card(card_id);
    return ok ? `${card_id} archived` : `Error: card not found: ${card_id}`;
  }

  private async handle_list_cards(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const column_id = str(p.column_id) || undefined;
    const limit = typeof p.limit === "number" ? p.limit : undefined;
    const assignee = str(p.assignee) || undefined;
    const cards = await this.store.list_cards(board_id, column_id, limit, assignee);
    if (cards.length === 0) return "카드 없음";
    return cards.map(c => {
      const parts = [`[${c.card_id}]`, c.title, `(${c.column_id})`];
      if (c.priority !== "none") parts.push(`P:${c.priority}`);
      if (c.assignee) parts.push(`→${c.assignee}`);
      if (c.comment_count > 0) parts.push(`💬${c.comment_count}`);
      return parts.join(" ");
    }).join("\n");
  }

  private async handle_get_card(p: Record<string, unknown>): Promise<string> {
    const card_id = str(p.card_id);
    if (!card_id) return "Error: card_id is required";
    const card = await this.store.get_card(card_id);
    if (!card) return `Error: card not found: ${card_id}`;

    const relations = await this.store.list_relations(card_id);
    const subtasks = await this.store.get_subtasks(card_id);
    const comments = await this.store.list_comments(card_id, 10);

    const lines = [
      `# ${card.card_id}: ${card.title}`,
      `status: ${card.column_id} | priority: ${card.priority} | assignee: ${card.assignee ?? "unassigned"}`,
      `created_by: ${card.created_by} | created: ${card.created_at}`,
    ];
    if (card.labels.length > 0) lines.push(`labels: ${card.labels.join(", ")}`);
    if (card.description) lines.push("", card.description);
    if (Object.keys(card.metadata).length > 0) lines.push("", "metadata: " + JSON.stringify(card.metadata));
    if (subtasks.length > 0) {
      const done_count = subtasks.filter(s => s.column_id === "done").length;
      lines.push("", `subtasks (${done_count}/${subtasks.length}):`);
      for (const s of subtasks) {
        const check = s.column_id === "done" ? "☑" : "☐";
        lines.push(`  ${check} ${s.card_id} ${s.title} (${s.column_id})`);
      }
    }
    if (relations.length > 0) {
      const non_subtask = relations.filter(r => r.type !== "parent_of" && r.type !== "child_of");
      if (non_subtask.length > 0) {
        lines.push("", "relations:");
        for (const r of non_subtask) {
          const target = r.source_card_id === card_id ? r.target_card_id : r.source_card_id;
          lines.push(`  ${r.type} → ${target}`);
        }
      }
    }
    if (comments.length > 0) {
      lines.push("", "comments:");
      for (const c of comments) {
        lines.push(`  [${c.author}] ${c.text}`);
      }
    }
    return lines.join("\n");
  }

  private async handle_board_summary(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const summary = await this.store.board_summary(board_id);
    if (!summary) return `Error: board not found: ${board_id}`;

    const lines = [
      `# ${summary.name}`,
      `progress: ${summary.done}/${summary.total} done (${summary.total > 0 ? Math.round(summary.done / summary.total * 100) : 0}%)`,
      "",
      ...summary.columns.map(c => `  ${c.name}: ${c.count}`),
    ];
    if (summary.blockers.length > 0) {
      lines.push("", "blockers:");
      for (const b of summary.blockers) {
        lines.push(`  ${b.card_id} "${b.title}" ← blocked_by ${b.blocked_by.join(", ")}`);
      }
    }
    return lines.join("\n");
  }

  private async handle_comment(p: Record<string, unknown>, agent_id: string): Promise<string> {
    const card_id = str(p.card_id);
    const text = str(p.text);
    if (!card_id || !text) return "Error: card_id and text are required";
    await this.store.add_comment(card_id, agent_id, text);
    return `comment added to ${card_id}`;
  }

  private async handle_list_comments(p: Record<string, unknown>): Promise<string> {
    const card_id = str(p.card_id);
    if (!card_id) return "Error: card_id is required";
    const limit = typeof p.limit === "number" ? p.limit : undefined;
    const comments = await this.store.list_comments(card_id, limit);
    if (comments.length === 0) return "코멘트 없음";
    return comments.map(c => `[${c.author} ${c.created_at}] ${c.text}`).join("\n");
  }

  private async handle_add_relation(p: Record<string, unknown>): Promise<string> {
    const source = str(p.source_card_id);
    const target = str(p.target_card_id);
    const type = str(p.type) as RelationType;
    if (!source || !target || !type) return "Error: source_card_id, target_card_id, and type are required";
    const rel = await this.store.add_relation(source, target, type);
    return `relation added: ${source} ${type} ${target} (id: ${rel.relation_id})`;
  }

  private async handle_remove_relation(p: Record<string, unknown>): Promise<string> {
    const relation_id = str(p.relation_id);
    if (!relation_id) return "Error: relation_id is required";
    const ok = await this.store.remove_relation(relation_id);
    return ok ? "relation removed" : "Error: relation not found";
  }

  /* ─── activity ─── */

  private async handle_list_activities(p: Record<string, unknown>): Promise<string> {
    const card_id = str(p.card_id) || undefined;
    const board_id = str(p.board_id) || undefined;
    if (!card_id && !board_id) return "Error: card_id or board_id is required";
    const limit = typeof p.limit === "number" ? p.limit : 50;
    const activities = await this.store.list_activities({ card_id, board_id, limit });
    if (activities.length === 0) return "활동 없음";
    return activities.map(a => `[${a.created_at}] ${a.actor} ${a.action} ${a.card_id}${Object.keys(a.detail).length ? " " + JSON.stringify(a.detail) : ""}`).join("\n");
  }

  /* ─── rules ─── */

  private async handle_add_rule(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    const trigger = str(p.trigger) as KanbanRule["trigger"];
    const action_type = str(p.action_type) as KanbanRule["action_type"];
    if (!board_id || !trigger || !action_type) return "Error: board_id, trigger, and action_type are required";
    const rule = await this.store.add_rule({
      board_id, trigger,
      condition: (p.condition as Record<string, unknown>) ?? {},
      action_type,
      action_params: (p.action_params as Record<string, unknown>) ?? {},
    });
    this.rule_executor?.watch(board_id);
    return `rule created: ${rule.rule_id} (${trigger} → ${action_type})`;
  }

  private async handle_list_rules(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const rules = await this.store.list_rules(board_id);
    if (rules.length === 0) return "규칙 없음";
    return rules.map(r => `[${r.rule_id}] ${r.trigger} → ${r.action_type} ${r.enabled ? "✓" : "✗"} ${JSON.stringify(r.condition)}`).join("\n");
  }

  private async handle_remove_rule(p: Record<string, unknown>): Promise<string> {
    const rule_id = str(p.rule_id);
    if (!rule_id) return "Error: rule_id is required";
    const ok = await this.store.remove_rule(rule_id);
    return ok ? "rule removed" : "Error: rule not found";
  }

  private async handle_toggle_rule(p: Record<string, unknown>): Promise<string> {
    const rule_id = str(p.rule_id);
    if (!rule_id) return "Error: rule_id is required";
    const enabled = typeof p.enabled === "boolean" ? p.enabled : true;
    const rule = await this.store.update_rule(rule_id, { enabled });
    if (!rule) return "Error: rule not found";
    if (rule.enabled) this.rule_executor?.watch(rule.board_id);
    return `rule ${rule_id} ${rule.enabled ? "enabled" : "disabled"}`;
  }

  /* ─── templates ─── */

  private async handle_create_template(p: Record<string, unknown>): Promise<string> {
    const name = str(p.name);
    if (!name) return "Error: name is required";
    const cards = (p.cards as Array<{ title: string; description?: string; column_id?: string; priority?: Priority; labels?: string[] }>) ?? [];
    if (cards.length === 0) return "Error: cards array is required";
    const template = await this.store.create_template({
      name,
      description: str(p.description) || undefined,
      columns: p.columns as Array<{ id: string; name: string; color: string }> | undefined,
      cards,
    });
    return `template created: ${template.template_id} "${template.name}" (${cards.length} cards)`;
  }

  private async handle_list_templates(): Promise<string> {
    const templates = await this.store.list_templates();
    if (templates.length === 0) return "템플릿 없음";
    return templates.map(t => `[${t.template_id}] ${t.name} — ${t.cards.length} cards`).join("\n");
  }

  private async handle_create_board_from_template(p: Record<string, unknown>): Promise<string> {
    const template_name = str(p.template_name) || str(p.template_id);
    if (!template_name) return "Error: template_name or template_id is required";
    const scope_type = str(p.scope_type) as ScopeType;
    const scope_id = str(p.scope_id);
    if (!scope_type || !scope_id) return "Error: scope_type and scope_id are required";

    const template = await this.store.get_template(template_name);
    if (!template) return `Error: template not found: ${template_name}`;

    const board_name = str(p.name) || template.name;
    const board = await this.store.create_board({
      name: board_name,
      scope_type, scope_id,
      columns: template.columns,
    });

    let created = 0;
    for (const tc of template.cards) {
      await this.store.create_card({
        board_id: board.board_id,
        title: tc.title,
        description: tc.description,
        column_id: tc.column_id,
        priority: tc.priority,
        labels: tc.labels,
        created_by: "template",
      });
      created++;
    }

    return `board created from template "${template.name}": ${board.board_id} (prefix: ${board.prefix}, ${created} cards)`;
  }

  private async handle_delete_template(p: Record<string, unknown>): Promise<string> {
    const template_id = str(p.template_id);
    if (!template_id) return "Error: template_id is required";
    const ok = await this.store.delete_template(template_id);
    return ok ? "template deleted" : "Error: template not found";
  }

  /* ─── metrics ─── */

  private async handle_board_metrics(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const days = typeof p.days === "number" ? p.days : 30;
    const metrics = await this.store.get_board_metrics(board_id, days);
    if (!metrics) return `Error: board not found: ${board_id}`;

    const lines = [
      `# Board Metrics (last ${days} days)`,
      `throughput: ${metrics.throughput} cards done`,
      `avg cycle time: ${metrics.avg_cycle_time_hours}h`,
      "",
      "columns: " + Object.entries(metrics.cards_by_column).map(([k, v]) => `${k}=${v}`).join(", "),
      "priority: " + Object.entries(metrics.cards_by_priority).map(([k, v]) => `${k}=${v}`).join(", "),
    ];
    if (metrics.velocity.length > 0) {
      lines.push("", "velocity (weekly):");
      for (const v of metrics.velocity) lines.push(`  ${v.week}: ${v.done} done`);
    }
    return lines.join("\n");
  }
  /* ─── time tracking ─── */

  private async handle_card_time_tracking(p: Record<string, unknown>): Promise<string> {
    const card_id = str(p.card_id);
    if (!card_id) return "Error: card_id is required";
    const tracking = await this.store.get_card_time_tracking(card_id);
    if (!tracking) return `Error: card not found: ${card_id}`;

    const lines = [`# ${card_id} Time Tracking (total: ${tracking.total_hours}h)`];
    for (const t of tracking.column_times) {
      const status = t.exited_at ? "" : " ← current";
      lines.push(`  ${t.column_id}: ${t.duration_hours}h${status}`);
    }
    return lines.join("\n");
  }

  /* ─── search ─── */

  private async handle_search(p: Record<string, unknown>): Promise<string> {
    const query = str(p.query);
    if (!query) return "Error: query is required";
    const results = await this.store.search_cards(query, {
      board_id: str(p.board_id) || undefined,
      limit: typeof p.limit === "number" ? p.limit : undefined,
    });
    if (results.length === 0) return `"${query}" 검색 결과 없음`;
    return results.map(r => `[${r.card_id}] ${r.title} (${r.board_name} / ${r.column_id}) P:${r.priority}`).join("\n");
  }

  /* ─── filters ─── */

  private async handle_save_filter(p: Record<string, unknown>, agent_id: string): Promise<string> {
    const board_id = str(p.board_id);
    const name = str(p.name);
    if (!board_id || !name) return "Error: board_id and name are required";
    const criteria = (p.criteria as Record<string, unknown>) ?? {};
    const filter = await this.store.save_filter({ board_id, name, criteria: criteria as import("../../services/kanban-store.js").FilterCriteria, created_by: agent_id });
    return `filter saved: "${filter.name}" (${filter.filter_id})`;
  }

  private async handle_list_filters(p: Record<string, unknown>): Promise<string> {
    const board_id = str(p.board_id);
    if (!board_id) return "Error: board_id is required";
    const filters = await this.store.list_filters(board_id);
    if (filters.length === 0) return "필터 없음";
    return filters.map(f => `[${f.filter_id}] ${f.name} — ${JSON.stringify(f.criteria)}`).join("\n");
  }

  private async handle_delete_filter(p: Record<string, unknown>): Promise<string> {
    const filter_id = str(p.filter_id);
    if (!filter_id) return "Error: filter_id is required";
    const ok = await this.store.delete_filter(filter_id);
    return ok ? "filter deleted" : "Error: filter not found";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
