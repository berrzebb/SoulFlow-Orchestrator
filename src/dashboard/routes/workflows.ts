/** /api/workflow/* 라우트 핸들러. */

import type { RouteHandler } from "../route-context.js";
import type { DashboardWorkflowOps } from "../service.js";
import { set_no_cache } from "../route-context.js";

export const handle_workflow: RouteHandler = async (ctx) => {
  const { req, res, url, json, read_body, options } = ctx;
  const ops: DashboardWorkflowOps | null = options.workflow_ops ?? null;
  if (!ops) { json(res, 501, { error: "workflow_ops_not_configured" }); return true; }

  const path = url.pathname;
  const method = req.method || "GET";

  // ── Runs (실행 인스턴스) ──

  // GET /api/workflow/runs — 목록
  if (path === "/api/workflow/runs" && method === "GET") {
    const list = await ops.list();
    json(res, 200, list);
    return true;
  }

  // POST /api/workflow/runs — 생성 및 실행
  if (path === "/api/workflow/runs" && method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // GET /api/workflow/runs/:id
  const detail_match = path.match(/^\/api\/workflow\/runs\/([^/]+)$/);
  if (detail_match && method === "GET") {
    const workflow = await ops.get(detail_match[1]);
    if (!workflow) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, workflow);
    return true;
  }

  // DELETE /api/workflow/runs/:id
  if (detail_match && method === "DELETE") {
    const ok = await ops.cancel(detail_match[1]);
    json(res, ok ? 200 : 404, { ok });
    return true;
  }

  // POST /api/workflow/runs/:id/resume
  const resume_match = path.match(/^\/api\/workflow\/runs\/([^/]+)\/resume$/);
  if (resume_match && method === "POST") {
    const result = await ops.resume(resume_match[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // PATCH /api/workflow/runs/:id/settings — auto_approve, auto_resume 설정
  const settings_match = path.match(/^\/api\/workflow\/runs\/([^/]+)\/settings$/);
  if (settings_match && method === "PATCH") {
    if (!ops.update_settings) { json(res, 501, { error: "not_supported" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update_settings(settings_match[1], {
      auto_approve: typeof body.auto_approve === "boolean" ? body.auto_approve : undefined,
      auto_resume: typeof body.auto_resume === "boolean" ? body.auto_resume : undefined,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // GET /api/workflow/runs/:id/messages?phase_id=&agent_id=
  const msg_match = path.match(/^\/api\/workflow\/runs\/([^/]+)\/messages$/);
  if (msg_match && method === "GET") {
    const phase_id = url.searchParams.get("phase_id") || "";
    const agent_id = url.searchParams.get("agent_id") || "";
    if (!phase_id || !agent_id) { json(res, 400, { error: "phase_id_and_agent_id_required" }); return true; }
    const messages = await ops.get_messages(msg_match[1], phase_id, agent_id);
    json(res, 200, messages);
    return true;
  }

  // POST /api/workflow/runs/:id/messages
  if (msg_match && method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.send_message(
      msg_match[1],
      String(body.phase_id || ""),
      String(body.agent_id || ""),
      String(body.content || ""),
    );
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // ── Roles ──

  // GET /api/workflow/roles
  if (path === "/api/workflow/roles" && method === "GET") {
    const roles = ops.list_roles();
    json(res, 200, roles);
    return true;
  }

  // ── Templates ──

  // GET /api/workflow/templates
  if (path === "/api/workflow/templates" && method === "GET") {
    const templates = ops.list_templates();
    json(res, 200, templates);
    return true;
  }

  // POST /api/workflow/templates — YAML 텍스트 import
  if (path === "/api/workflow/templates" && method === "POST") {
    const body = await read_body(req);
    if (!body?.yaml || typeof body.yaml !== "string") { json(res, 400, { error: "yaml_required" }); return true; }
    const result = ops.import_template(body.yaml);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // /api/workflow/templates/:name
  const tpl_match = path.match(/^\/api\/workflow\/templates\/([^/]+)$/);
  if (tpl_match) {
    const name = decodeURIComponent(tpl_match[1]);

    // GET — 단일 조회
    if (method === "GET") {
      const tpl = ops.get_template(name);
      if (!tpl) { json(res, 404, { error: "template_not_found" }); return true; }
      json(res, 200, tpl);
      return true;
    }

    // PUT — 생성/수정
    if (method === "PUT") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const slug = ops.save_template(name, body as unknown as import("../../agent/phase-loop.types.js").WorkflowDefinition);
      json(res, 200, { ok: true, name: slug });
      return true;
    }

    // DELETE — 삭제
    if (method === "DELETE") {
      const ok = ops.delete_template(name);
      json(res, ok ? 200 : 404, { ok });
      return true;
    }
  }

  // POST /api/workflow/suggest — LLM 기반 워크플로우 편집 제안 (단발 응답)
  if (path === "/api/workflow/suggest" && method === "POST") {
    if (!ops.suggest) { json(res, 501, { error: "not_implemented" }); return true; }
    const body = await read_body(req);
    if (!body?.instruction || typeof body.instruction !== "string") { json(res, 400, { error: "instruction_required" }); return true; }
    if (!body.workflow || typeof body.workflow !== "object") { json(res, 400, { error: "workflow_required" }); return true; }
    const result = await ops.suggest(body.instruction, {
      name: typeof body.name === "string" ? body.name : undefined,
      workflow: body.workflow ? body.workflow as Record<string, unknown> : undefined,
      provider_id: typeof body.provider_instance_id === "string" ? body.provider_instance_id : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      save: body.save === true,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/workflow/suggest/stream — SSE 스트리밍 (patch 이벤트 실시간 전달)
  if (path === "/api/workflow/suggest/stream" && method === "POST") {
    if (!ops.suggest) { json(res, 501, { error: "not_implemented" }); return true; }
    const body = await read_body(req);
    if (!body?.instruction || typeof body.instruction !== "string") { json(res, 400, { error: "instruction_required" }); return true; }
    const has_name = typeof body.name === "string" && body.name.trim();
    const has_workflow = body.workflow && typeof body.workflow === "object";

    set_no_cache(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
      // 역방향 프록시(Nginx 등) 버퍼링 비활성화
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache, no-transform",
    });
    // 연결 즉시 헤더 플러시 (일부 프록시가 첫 바이트 전까지 버퍼링)
    res.write(":\n\n");

    const send_event = (event: string, data: unknown) => {
      if (!res.destroyed) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // Node.js HTTP는 write 후 자동 플러시하지 않을 수 있음
        (res as unknown as { flush?: () => void }).flush?.();
      }
    };

    try {
      const result = await ops.suggest(body.instruction, {
        name: has_name ? String(body.name) : undefined,
        workflow: has_workflow ? body.workflow as Record<string, unknown> : undefined,
        provider_id: typeof body.provider_instance_id === "string" ? body.provider_instance_id : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        save: body.save === true,
        on_patch: (patch_path, section) => send_event("patch", { path: patch_path, section }),
      });
      send_event(result.ok ? "done" : "error", result);
    } catch (err) {
      send_event("error", { ok: false, error: String(err) });
    }

    if (!res.destroyed) res.end();
    return true;
  }

  // GET /api/workflow/templates/:name/export — YAML 텍스트 export
  const export_match = path.match(/^\/api\/workflow\/templates\/([^/]+)\/export$/);
  if (export_match && method === "GET") {
    const yaml_text = ops.export_template(decodeURIComponent(export_match[1]));
    if (!yaml_text) { json(res, 404, { error: "template_not_found" }); return true; }
    res.writeHead(200, { "Content-Type": "text/yaml; charset=utf-8" });
    res.end(yaml_text);
    return true;
  }

  return false;
};

/** POST /api/workflow/node/runs, /api/workflow/node/tests — 노드 단독 실행/테스트. */
export const handle_workflow_node: RouteHandler = async (ctx) => {
  const { req, res, url, json, read_body, options } = ctx;
  const ops: DashboardWorkflowOps | null = options.workflow_ops ?? null;
  if (!ops) { json(res, 501, { error: "workflow_ops_not_configured" }); return true; }

  const path = url.pathname;
  const method = req.method || "GET";

  // POST /api/workflow/node/runs
  if (path === "/api/workflow/node/runs" && method === "POST") {
    if (!ops.run_single_node) { json(res, 501, { error: "not_implemented" }); return true; }
    const body = await read_body(req);
    if (!body?.node) { json(res, 400, { error: "node_required" }); return true; }
    const mem = (body.input_memory && typeof body.input_memory === "object" ? body.input_memory : {}) as Record<string, unknown>;
    const result = await ops.run_single_node(body.node as Record<string, unknown>, mem);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/workflow/node/tests
  if (path === "/api/workflow/node/tests" && method === "POST") {
    if (!ops.test_single_node) { json(res, 501, { error: "not_implemented" }); return true; }
    const body = await read_body(req);
    if (!body?.node) { json(res, 400, { error: "node_required" }); return true; }
    const tmem = (body.input_memory && typeof body.input_memory === "object" ? body.input_memory : {}) as Record<string, unknown>;
    const result = ops.test_single_node(body.node as Record<string, unknown>, tmem);
    json(res, 200, result);
    return true;
  }

  return false;
};
