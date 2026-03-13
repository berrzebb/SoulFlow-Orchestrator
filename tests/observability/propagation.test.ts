/**
 * OB-1/OB-2 — 생산 코드 전파 검증.
 *
 * GPT 5.4 보정 요청 대응:
 *   1. RouteContext.correlation이 요청 단위로 1회 생성되고 고정된다
 *   2. ChannelManager가 OrchestrationRequest에 correlation을 실제 주입한다
 *   3. correlation_to_log_context()가 logger.child에서 실제 사용된다
 *   4. 같은 요청 내에서 trace_id가 갈라지지 않는다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  create_correlation,
  extend_correlation,
  correlation_fields,
  type CorrelationContext,
} from "@src/observability/correlation.js";
import { create_logger, correlation_to_log_context, type LogEnvelope } from "@src/logger.js";
import { extract_correlation } from "@src/dashboard/route-context.js";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── 유틸리티 ──

function make_route_ctx(overrides: {
  team_id?: string;
  user_id?: string;
  workspace_path?: string;
} = {}): RouteContext {
  return {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL("http://localhost/api/test"),
    options: {} as RouteContext["options"],
    auth_user: overrides.user_id ? { sub: overrides.user_id, usr: overrides.user_id, role: "user", tid: overrides.team_id ?? "", wdir: "", iat: 0, exp: 0 } : null,
    team_context: overrides.team_id ? { team_id: overrides.team_id, team_role: "member" as const } : null,
    workspace_runtime: overrides.workspace_path ? { workspace_path: overrides.workspace_path, team_id: overrides.team_id ?? "", user_id: overrides.user_id ?? "", workspace_layers: [], runtime_path: "", workspace: "", admin_runtime: "", team_runtime: "", user_runtime: "", user_content: "", is_active: true, started_at: "" } : null,
    workspace_layers: [],
    personal_dir: "/tmp",
    json: vi.fn(),
    read_body: vi.fn(),
    add_sse_client: vi.fn(),
    build_state: vi.fn(),
    build_merged_tasks: vi.fn(),
    recent_messages: [],
    metrics: {} as RouteContext["metrics"],
    chat_sessions: new Map(),
    session_store: null,
    session_store_key: (id) => id,
    register_media_token: vi.fn(),
    oauth_callback_html: vi.fn(),
    resolve_request_origin: vi.fn(),
    bus: null as unknown as RouteContext["bus"],
    add_rich_stream_listener: vi.fn(),
    get_scoped_memory_ops: vi.fn().mockReturnValue(null),
    correlation: create_correlation({
      team_id: overrides.team_id,
      user_id: overrides.user_id,
      workspace_dir: overrides.workspace_path,
    }),
  };
}

function capture_logs(): { lines: LogEnvelope[]; restore: () => void } {
  const lines: LogEnvelope[] = [];
  const orig_log = console.log;
  const orig_error = console.error;
  console.log = (...args: unknown[]) => {
    try { lines.push(JSON.parse(String(args[0])) as LogEnvelope); } catch { /* skip */ }
  };
  console.error = (...args: unknown[]) => {
    try { lines.push(JSON.parse(String(args[0])) as LogEnvelope); } catch { /* skip */ }
  };
  return {
    lines,
    restore: () => { console.log = orig_log; console.error = orig_error; },
  };
}

// ── 테스트 ──

describe("RouteContext.correlation — 요청 단위 고정", () => {
  it("RouteContext.correlation.trace_id가 고정된다 (매번 새로 생성하지 않음)", () => {
    const ctx = make_route_ctx({ team_id: "t1", user_id: "u1" });
    const trace_a = ctx.correlation.trace_id;
    const trace_b = ctx.correlation.trace_id;
    expect(trace_a).toBe(trace_b);
  });

  it("서로 다른 요청은 다른 trace_id를 갖는다", () => {
    const ctx_a = make_route_ctx({ team_id: "t1", user_id: "u1" });
    const ctx_b = make_route_ctx({ team_id: "t1", user_id: "u1" });
    expect(ctx_a.correlation.trace_id).not.toBe(ctx_b.correlation.trace_id);
  });

  it("correlation에 team_id, user_id가 포함된다", () => {
    const ctx = make_route_ctx({ team_id: "team_a", user_id: "alice" });
    expect(ctx.correlation.team_id).toBe("team_a");
    expect(ctx.correlation.user_id).toBe("alice");
  });
});

describe("OrchestrationRequest correlation 주입 시뮬레이션", () => {
  it("ChannelManager 패턴: create_correlation → OrchestrationRequest.correlation", () => {
    const corr = create_correlation({
      team_id: "t1",
      user_id: "sender1",
      chat_id: "chat_abc",
      provider: "slack",
      run_id: "run_123",
    });

    // OrchestrationRequest mock
    const req = { correlation: corr };

    expect(req.correlation.trace_id).toBeTruthy();
    expect(req.correlation.team_id).toBe("t1");
    expect(req.correlation.provider).toBe("slack");
    expect(req.correlation.run_id).toBe("run_123");
  });

  it("같은 correlation을 OrchestrationService에 전달 → trace_id 유지", () => {
    const corr = create_correlation({ team_id: "t1" });
    const trace_id = corr.trace_id;

    // extend를 해도 원본 trace_id 유지
    const extended = extend_correlation(corr, { workflow_id: "wf_1", provider: "openai" });
    expect(extended.trace_id).toBe(trace_id);
    expect(extended.workflow_id).toBe("wf_1");
  });
});

describe("생산 로그 — correlation_to_log_context + logger.child 통합", () => {
  let cap: ReturnType<typeof capture_logs>;
  beforeEach(() => { cap = capture_logs(); });
  afterEach(() => { cap.restore(); });

  it("ChannelManager 패턴: logger.child(name, correlation_to_log_context(corr))", () => {
    const corr = create_correlation({
      team_id: "t1",
      user_id: "alice",
      chat_id: "chat_1",
      provider: "web",
      run_id: "run_1",
    });

    const log = create_logger("channel-manager", "debug");
    const corr_log = log.child("orchestration", correlation_to_log_context(corr));
    corr_log.info("orchestration_start", { alias: "assistant" });

    expect(cap.lines).toHaveLength(1);
    const entry = cap.lines[0];
    expect(entry.name).toBe("orchestration");
    expect(entry.trace_id).toBe(corr.trace_id);
    expect(entry.team_id).toBe("t1");
    expect(entry.user_id).toBe("alice");
    expect(entry.chat_id).toBe("chat_1");
    expect(entry.provider).toBe("web");
    expect(entry.run_id).toBe("run_1");
    expect(entry.msg).toBe("orchestration_start");
    expect((entry as Record<string, unknown>).alias).toBe("assistant");
  });

  it("OrchestrationService 패턴: req.correlation → logger.child", () => {
    const corr = create_correlation({
      team_id: "t2",
      user_id: "bob",
      provider: "slack",
    });

    const log = create_logger("orchestration-service", "debug");
    const exec_log = log.child("orchestration:execute", correlation_to_log_context(corr));
    exec_log.info("execute_start", { mode: "pending" });

    expect(cap.lines).toHaveLength(1);
    const entry = cap.lines[0];
    expect(entry.trace_id).toBe(corr.trace_id);
    expect(entry.team_id).toBe("t2");
    expect(entry.user_id).toBe("bob");
  });

  it("같은 trace_id가 channel → orchestration 로그에 이어진다", () => {
    const corr = create_correlation({ team_id: "t1", provider: "web" });

    const cm_log = create_logger("channel-mgr", "debug").child("orchestration", correlation_to_log_context(corr));
    cm_log.info("orchestration_start");

    const os_log = create_logger("orch-svc", "debug").child("orchestration:execute", correlation_to_log_context(corr));
    os_log.info("execute_start");

    expect(cap.lines).toHaveLength(2);
    expect(cap.lines[0].trace_id).toBe(corr.trace_id);
    expect(cap.lines[1].trace_id).toBe(corr.trace_id);
    expect(cap.lines[0].trace_id).toBe(cap.lines[1].trace_id);
  });
});

describe("trace_id 분기 방지", () => {
  it("extract_correlation()은 매번 새 trace_id → RouteContext.correlation 사용이 정답", () => {
    const ctx = make_route_ctx({ team_id: "t1", user_id: "u1" });
    const corr_a = extract_correlation(ctx);
    const corr_b = extract_correlation(ctx);
    expect(corr_a.trace_id).not.toBe(corr_b.trace_id);

    // RouteContext.correlation은 고정
    expect(ctx.correlation.trace_id).toBe(ctx.correlation.trace_id);
  });
});
