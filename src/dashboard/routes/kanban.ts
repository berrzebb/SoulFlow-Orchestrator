/** 칸반 보드 REST API 핸들러. */

import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";
import type { KanbanStoreLike, ScopeType, KanbanColumnDef, Priority, RelationType, KanbanRule, FilterCriteria, KanbanEvent } from "../../services/kanban-store.js";
import type { KanbanRuleExecutor } from "../../services/kanban-rule-executor.js";
import { error_message } from "../../utils/common.js";

function get_store(ctx: RouteContext): KanbanStoreLike | null {
  return (ctx.options as Record<string, unknown>).kanban_store as KanbanStoreLike | null ?? null;
}

function get_rule_executor(ctx: RouteContext): KanbanRuleExecutor | null {
  const val = (ctx.options as Record<string, unknown>).kanban_rule_executor;
  if (typeof val === "function") return (val as () => KanbanRuleExecutor | null)();
  return val as KanbanRuleExecutor | null ?? null;
}

function store_or_503(ctx: RouteContext): KanbanStoreLike | null {
  const store = get_store(ctx);
  if (!store) ctx.json(ctx.res, 503, { error: "kanban_unavailable" });
  return store;
}

/** 사용자가 해당 scope에 접근 가능한지 검사. superadmin/no-auth → 항상 허용. */
function can_access_scope(ctx: RouteContext, scope_type: string, scope_id: string): boolean {
  const team_id = get_filter_team_id(ctx);
  if (team_id === undefined) return true;
  if (scope_type === "team") return scope_id === team_id;
  if (scope_type === "personal") return scope_id === (ctx.auth_user?.sub ?? "");
  return false; // global 등 기타 scope는 superadmin만
}

/** 보드 ID로 소유권 검사. 보드 없으면 null(404 처리 위임). */
async function check_board_access(ctx: RouteContext, store: KanbanStoreLike, board_id: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const team_id = get_filter_team_id(ctx);
  if (team_id === undefined) return { ok: true };
  const board = await store.get_board(board_id);
  if (!board) return { ok: false, status: 404 };
  if (!can_access_scope(ctx, board.scope_type, board.scope_id)) return { ok: false, status: 403 };
  return { ok: true };
}

export async function handle_kanban(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;
  const method = req.method ?? "";

  /* ═══ Boards ═══ */

  // GET /api/kanban/boards
  if (path === "/api/kanban/boards" && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const scope_param = url.searchParams.get("scope");
    let scope_type: ScopeType | undefined;
    let scope_id: string | undefined;
    if (scope_param) {
      const [t, ...rest] = scope_param.split(":");
      scope_type = t as ScopeType;
      scope_id = rest.join(":");
    }
    // 요청된 scope 접근 권한 검사
    if (scope_type && scope_id && !can_access_scope(ctx, scope_type, scope_id)) {
      json(res, 403, { error: "forbidden" }); return true;
    }
    let boards = await store.list_boards(scope_type, scope_id);
    // scope 필터 없이 전체 조회 시, 접근 가능한 scope만 반환
    const team_id = get_filter_team_id(ctx);
    if (team_id !== undefined && !scope_type) {
      boards = boards.filter((b) => can_access_scope(ctx, b.scope_type, b.scope_id));
    }
    json(res, 200, boards);
    return true;
  }

  // POST /api/kanban/boards
  if (path === "/api/kanban/boards" && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const body = await read_body(req);
    if (!body?.name || !body?.scope_type || !body?.scope_id) {
      json(res, 400, { error: "name, scope_type, scope_id required" });
      return true;
    }
    if (!can_access_scope(ctx, String(body.scope_type), String(body.scope_id))) {
      json(res, 403, { error: "forbidden" }); return true;
    }
    try {
      const board = await store.create_board({
        name: String(body.name),
        scope_type: String(body.scope_type) as ScopeType,
        scope_id: String(body.scope_id),
        columns: body.columns as KanbanColumnDef[] | undefined,
      });
      json(res, 201, board);
    } catch (e) {
      json(res, 409, { error: error_message(e) });
    }
    return true;
  }

  // GET /api/kanban/boards/:id
  const board_match = path.match(/^\/api\/kanban\/boards\/([^/]+)$/);
  if (board_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_match[1]);
    const access = await check_board_access(ctx, store, board_id);
    if (!access.ok) { json(res, access.status, { error: access.status === 403 ? "forbidden" : "not_found" }); return true; }
    const board = await store.get_board(board_id);
    if (!board) { json(res, 404, { error: "not_found" }); return true; }
    const assignee = url.searchParams.get("assignee") ?? undefined;
    const cards = await store.list_cards(board_id, undefined, undefined, assignee);
    const subtask_counts = await store.get_subtask_counts(board_id);
    const cards_enriched = await Promise.all(
      cards.map(async (c) => {
        const participants = await store.get_participants(c.card_id);
        const sc = subtask_counts.get(c.card_id);
        return { ...c, participants, subtask_total: sc?.total ?? 0, subtask_done: sc?.done ?? 0 };
      }),
    );
    json(res, 200, { ...board, cards: cards_enriched });
    return true;
  }

  // PUT /api/kanban/boards/:id
  if (board_match && method === "PUT") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_match[1]);
    const access = await check_board_access(ctx, store, board_id);
    if (!access.ok) { json(res, access.status, { error: access.status === 403 ? "forbidden" : "not_found" }); return true; }
    const body = await read_body(req);
    const board = await store.update_board(board_id, {
      name: body?.name ? String(body.name) : undefined,
      columns: body?.columns as KanbanColumnDef[] | undefined,
    });
    json(res, board ? 200 : 404, board ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/kanban/boards/:id
  if (board_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_match[1]);
    const access = await check_board_access(ctx, store, board_id);
    if (!access.ok) { json(res, access.status, { error: access.status === 403 ? "forbidden" : "not_found" }); return true; }
    const ok = await store.delete_board(board_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ Cards ═══ */

  // POST /api/kanban/boards/:id/cards
  const board_cards_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/cards$/);
  if (board_cards_match && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_cards_match[1]);
    const access = await check_board_access(ctx, store, board_id);
    if (!access.ok) { json(res, access.status, { error: access.status === 403 ? "forbidden" : "not_found" }); return true; }
    const body = await read_body(req);
    if (!body?.title) { json(res, 400, { error: "title required" }); return true; }
    try {
      const card = await store.create_card({
        board_id,
        title: String(body.title),
        description: body.description ? String(body.description) : undefined,
        column_id: body.column_id ? String(body.column_id) : undefined,
        priority: body.priority as Priority | undefined,
        labels: body.labels as string[] | undefined,
        assignee: body.assignee ? String(body.assignee) : undefined,
        created_by: "user:dashboard",
        parent_id: body.parent_id ? String(body.parent_id) : undefined,
        task_id: body.task_id ? String(body.task_id) : undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });
      json(res, 201, card);
    } catch (e) {
      json(res, 400, { error: error_message(e) });
    }
    return true;
  }

  // FE-6a: card 접근 전 parent board 소유권 검사 헬퍼
  async function check_card_board_access(store: KanbanStoreLike, card_id: string): Promise<{ ok: true } | { ok: false; status: number }> {
    const card = await store.get_card(card_id);
    if (!card) return { ok: false, status: 404 };
    return check_board_access(ctx, store, card.board_id);
  }

  // GET /api/kanban/cards/:id — FE-6a: board 소유권 검사 추가
  const card_match = path.match(/^\/api\/kanban\/cards\/([^/]+)$/);
  if (card_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(card_match[1]);
    const access = await check_card_board_access(store, card_id);
    if (!access.ok) { json(res, access.status, { error: access.status === 404 ? "not_found" : "forbidden" }); return true; }
    const card = await store.get_card(card_id);
    json(res, card ? 200 : 404, card ?? { error: "not_found" });
    return true;
  }

  // PUT /api/kanban/cards/:id — FE-6a: board 소유권 검사 추가
  if (card_match && method === "PUT") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(card_match[1]);
    const put_access = await check_card_board_access(store, card_id);
    if (!put_access.ok) { json(res, put_access.status, { error: put_access.status === 404 ? "not_found" : "forbidden" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "body required" }); return true; }

    // column_id가 있으면 move, 아니면 update
    if (body.column_id) {
      const card = await store.move_card(card_id, String(body.column_id), typeof body.position === "number" ? body.position : undefined);
      if (!card) { json(res, 404, { error: "not_found" }); return true; }
      // move 후 추가 필드가 있으면 update
      const has_update_fields = body.title || body.description !== undefined || body.priority || body.labels || body.assignee !== undefined || body.metadata || body.task_id !== undefined;
      if (has_update_fields) {
        const updated = await store.update_card(card_id, {
          title: body.title ? String(body.title) : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          priority: body.priority as Priority | undefined,
          labels: body.labels as string[] | undefined,
          assignee: body.assignee !== undefined ? (body.assignee ? String(body.assignee) : null) : undefined,
          task_id: body.task_id !== undefined ? (body.task_id ? String(body.task_id) : null) : undefined,
          metadata: body.metadata as Record<string, unknown> | undefined,
        });
        json(res, 200, updated);
      } else {
        json(res, 200, card);
      }
    } else {
      const card = await store.update_card(card_id, {
        title: body.title ? String(body.title) : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        priority: body.priority as Priority | undefined,
        labels: body.labels as string[] | undefined,
        assignee: body.assignee !== undefined ? (body.assignee ? String(body.assignee) : null) : undefined,
        task_id: body.task_id !== undefined ? (body.task_id ? String(body.task_id) : null) : undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });
      json(res, card ? 200 : 404, card ?? { error: "not_found" });
    }
    return true;
  }

  // DELETE /api/kanban/cards/:id — FE-6a: board 소유권 검사 추가
  if (card_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(card_match[1]);
    const del_access = await check_card_board_access(store, card_id);
    if (!del_access.ok) { json(res, del_access.status, { error: del_access.status === 404 ? "not_found" : "forbidden" }); return true; }
    const ok = await store.delete_card(card_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ Comments ═══ */

  const comments_match = path.match(/^\/api\/kanban\/cards\/([^/]+)\/comments$/);
  if (comments_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(comments_match[1]);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const comments = await store.list_comments(card_id, limit);
    json(res, 200, comments);
    return true;
  }

  if (comments_match && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(comments_match[1]);
    const body = await read_body(req);
    if (!body?.text) { json(res, 400, { error: "text required" }); return true; }
    const comment = await store.add_comment(card_id, String(body.author ?? "user:dashboard"), String(body.text));
    json(res, 201, comment);
    return true;
  }

  /* ═══ Relations ═══ */

  const card_relations_match = path.match(/^\/api\/kanban\/cards\/([^/]+)\/relations$/);
  if (card_relations_match && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const source_card_id = decodeURIComponent(card_relations_match[1]);
    const body = await read_body(req);
    if (!body?.target_card_id || !body?.type) { json(res, 400, { error: "target_card_id and type required" }); return true; }
    const rel = await store.add_relation(source_card_id, String(body.target_card_id), String(body.type) as RelationType);
    json(res, 201, rel);
    return true;
  }

  // GET /api/kanban/cards/:id/relations
  if (card_relations_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(card_relations_match[1]);
    const relations = await store.list_relations(card_id);
    json(res, 200, relations);
    return true;
  }

  // DELETE /api/kanban/relations/:id
  const rel_match = path.match(/^\/api\/kanban\/relations\/([^/]+)$/);
  if (rel_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const relation_id = decodeURIComponent(rel_match[1]);
    const ok = await store.remove_relation(relation_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ Summary ═══ */

  const summary_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/summary$/);
  if (summary_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(summary_match[1]);
    const summary = await store.board_summary(board_id);
    json(res, summary ? 200 : 404, summary ?? { error: "not_found" });
    return true;
  }

  /* ═══ Subtasks ═══ */

  const subtasks_match = path.match(/^\/api\/kanban\/cards\/([^/]+)\/subtasks$/);
  if (subtasks_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(subtasks_match[1]);
    const subtasks = await store.get_subtasks(card_id);
    json(res, 200, subtasks);
    return true;
  }

  /* ═══ Activities ═══ */

  // GET /api/kanban/boards/:id/activities
  const board_activities_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/activities$/);
  if (board_activities_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_activities_match[1]);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100;
    const activities = await store.list_activities({ board_id, limit });
    json(res, 200, activities);
    return true;
  }

  // GET /api/kanban/cards/:id/activities
  const card_activities_match = path.match(/^\/api\/kanban\/cards\/([^/]+)\/activities$/);
  if (card_activities_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(card_activities_match[1]);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
    const activities = await store.list_activities({ card_id, limit });
    json(res, 200, activities);
    return true;
  }

  /* ═══ Rules ═══ */

  // GET /api/kanban/boards/:id/rules
  const board_rules_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/rules$/);
  if (board_rules_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_rules_match[1]);
    const rules = await store.list_rules(board_id);
    json(res, 200, rules);
    return true;
  }

  // POST /api/kanban/boards/:id/rules
  if (board_rules_match && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_rules_match[1]);
    const body = await read_body(req);
    if (!body?.trigger || !body?.action_type) {
      json(res, 400, { error: "trigger and action_type required" });
      return true;
    }
    try {
      const rule = await store.add_rule({
        board_id,
        trigger: String(body.trigger) as KanbanRule["trigger"],
        condition: (body.condition as Record<string, unknown>) ?? {},
        action_type: String(body.action_type) as KanbanRule["action_type"],
        action_params: (body.action_params as Record<string, unknown>) ?? {},
      });
      get_rule_executor(ctx)?.watch(board_id);
      json(res, 201, rule);
    } catch (e) {
      json(res, 400, { error: error_message(e) });
    }
    return true;
  }

  // PUT /api/kanban/rules/:id
  const rule_match = path.match(/^\/api\/kanban\/rules\/([^/]+)$/);
  if (rule_match && method === "PUT") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const rule_id = decodeURIComponent(rule_match[1]);
    const body = await read_body(req);
    const rule = await store.update_rule(rule_id, {
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      condition: body?.condition as Record<string, unknown> | undefined,
      action_params: body?.action_params as Record<string, unknown> | undefined,
    });
    if (rule?.enabled) get_rule_executor(ctx)?.watch(rule.board_id);
    json(res, rule ? 200 : 404, rule ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/kanban/rules/:id
  if (rule_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const rule_id = decodeURIComponent(rule_match[1]);
    const ok = await store.remove_rule(rule_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ Templates ═══ */

  // GET /api/kanban/templates
  if (path === "/api/kanban/templates" && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const templates = await store.list_templates();
    json(res, 200, templates);
    return true;
  }

  // POST /api/kanban/templates
  if (path === "/api/kanban/templates" && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const body = await read_body(req);
    if (!body?.name || !body?.cards) {
      json(res, 400, { error: "name and cards required" });
      return true;
    }
    try {
      const template = await store.create_template({
        name: String(body.name),
        description: body.description ? String(body.description) : undefined,
        columns: body.columns as KanbanColumnDef[] | undefined,
        cards: body.cards as Array<{ title: string; description?: string; column_id?: string; priority?: Priority; labels?: string[] }>,
      });
      json(res, 201, template);
    } catch (e) {
      json(res, 409, { error: error_message(e) });
    }
    return true;
  }

  // GET /api/kanban/templates/:id
  const template_match = path.match(/^\/api\/kanban\/templates\/([^/]+)$/);
  if (template_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const template_id = decodeURIComponent(template_match[1]);
    const template = await store.get_template(template_id);
    json(res, template ? 200 : 404, template ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/kanban/templates/:id
  if (template_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const template_id = decodeURIComponent(template_match[1]);
    const ok = await store.delete_template(template_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ Metrics ═══ */

  // GET /api/kanban/boards/:id/metrics
  const metrics_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/metrics$/);
  if (metrics_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(metrics_match[1]);
    const days = url.searchParams.has("days") ? Number(url.searchParams.get("days")) : 30;
    const metrics = await store.get_board_metrics(board_id, days);
    json(res, metrics ? 200 : 404, metrics ?? { error: "not_found" });
    return true;
  }

  /* ═══ Time Tracking ═══ */

  // GET /api/kanban/cards/:id/time-tracking
  const time_tracking_match = path.match(/^\/api\/kanban\/cards\/([^/]+)\/time-tracking$/);
  if (time_tracking_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const card_id = decodeURIComponent(time_tracking_match[1]);
    const tracking = await store.get_card_time_tracking(card_id);
    json(res, tracking ? 200 : 404, tracking ?? { error: "not_found" });
    return true;
  }

  /* ═══ Search ═══ */

  // GET /api/kanban/search?q=...&board_id=...&limit=...
  if (path === "/api/kanban/search" && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const q = url.searchParams.get("q") ?? "";
    if (!q) { json(res, 400, { error: "q parameter required" }); return true; }
    const board_id = url.searchParams.get("board_id") ?? undefined;
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 20;
    const results = await store.search_cards(q, { board_id, limit });
    json(res, 200, results);
    return true;
  }

  /* ═══ Filters ═══ */

  // GET /api/kanban/boards/:id/filters
  const board_filters_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/filters$/);
  if (board_filters_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_filters_match[1]);
    const filters = await store.list_filters(board_id);
    json(res, 200, filters);
    return true;
  }

  // POST /api/kanban/boards/:id/filters
  if (board_filters_match && method === "POST") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(board_filters_match[1]);
    const body = await read_body(req);
    if (!body?.name) { json(res, 400, { error: "name required" }); return true; }
    try {
      const filter = await store.save_filter({
        board_id,
        name: String(body.name),
        criteria: (body.criteria as FilterCriteria) ?? {},
      });
      json(res, 201, filter);
    } catch (e) {
      json(res, 409, { error: error_message(e) });
    }
    return true;
  }

  // DELETE /api/kanban/filters/:id
  const filter_match = path.match(/^\/api\/kanban\/filters\/([^/]+)$/);
  if (filter_match && method === "DELETE") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const filter_id = decodeURIComponent(filter_match[1]);
    const ok = await store.delete_filter(filter_id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
    return true;
  }

  /* ═══ SSE Event Stream ═══ */

  // GET /api/kanban/boards/:id/events
  const events_match = path.match(/^\/api\/kanban\/boards\/([^/]+)\/events$/);
  if (events_match && method === "GET") {
    const store = store_or_503(ctx);
    if (!store) return true;
    const board_id = decodeURIComponent(events_match[1]);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":\n\n"); // initial comment to flush headers

    const listener = (event: KanbanEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    store.subscribe(board_id, listener);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(":\n\n");
    }, 30_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      store.unsubscribe(board_id, listener);
    });
    return true;
  }

  return false;
}
