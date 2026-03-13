/**
 * OB-1 Correlation Context — 단위 테스트.
 *
 * 검증 항목:
 *   1. create_correlation(): trace_id 자동 생성, seed 필드 반영
 *   2. extend_correlation(): undefined 값 비덮어쓰기, 새 필드 추가
 *   3. correlation_fields(): undefined 제거, string 변환
 *   4. extract_correlation(): RouteContext에서 correlation 추출
 */
import { describe, it, expect, vi } from "vitest";
import {
  create_correlation,
  extend_correlation,
  correlation_fields,
  type CorrelationContext,
} from "@src/observability/correlation.js";
import { extract_correlation } from "@src/dashboard/route-context.js";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── create_correlation ──

describe("create_correlation", () => {
  it("trace_id가 UUID 형식으로 자동 생성된다", () => {
    const ctx = create_correlation();
    expect(ctx.trace_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("매번 다른 trace_id를 생성한다", () => {
    const a = create_correlation();
    const b = create_correlation();
    expect(a.trace_id).not.toBe(b.trace_id);
  });

  it("seed 필드가 반영된다", () => {
    const ctx = create_correlation({ team_id: "t1", user_id: "u1" });
    expect(ctx.team_id).toBe("t1");
    expect(ctx.user_id).toBe("u1");
  });

  it("seed의 trace_id가 자동 생성 값을 덮어쓴다", () => {
    const ctx = create_correlation({ trace_id: "custom-trace" });
    expect(ctx.trace_id).toBe("custom-trace");
  });

  it("seed 없이 호출하면 trace_id만 채워진다", () => {
    const ctx = create_correlation();
    expect(ctx.trace_id).toBeTruthy();
    expect(ctx.team_id).toBeUndefined();
    expect(ctx.run_id).toBeUndefined();
  });
});

// ── extend_correlation ──

describe("extend_correlation", () => {
  it("새 필드를 추가한다", () => {
    const base = create_correlation({ team_id: "t1" });
    const extended = extend_correlation(base, { run_id: "r1", workflow_id: "w1" });
    expect(extended.team_id).toBe("t1");
    expect(extended.run_id).toBe("r1");
    expect(extended.workflow_id).toBe("w1");
  });

  it("undefined 값은 기존 값을 덮어쓰지 않는다", () => {
    const base = create_correlation({ team_id: "t1", user_id: "u1" });
    const extended = extend_correlation(base, { team_id: undefined, provider: "openai" });
    expect(extended.team_id).toBe("t1");
    expect(extended.provider).toBe("openai");
  });

  it("원본 context를 변경하지 않는다 (immutable)", () => {
    const base = create_correlation({ team_id: "t1" });
    const trace_id = base.trace_id;
    extend_correlation(base, { team_id: "t2" });
    expect(base.team_id).toBe("t1");
    expect(base.trace_id).toBe(trace_id);
  });

  it("trace_id도 덮어쓸 수 있다", () => {
    const base = create_correlation();
    const extended = extend_correlation(base, { trace_id: "override" });
    expect(extended.trace_id).toBe("override");
    expect(base.trace_id).not.toBe("override");
  });
});

// ── correlation_fields ──

describe("correlation_fields", () => {
  it("undefined 필드를 제거한다", () => {
    const fields = correlation_fields({ trace_id: "t", team_id: undefined, user_id: "u" });
    expect(fields).toEqual({ trace_id: "t", user_id: "u" });
    expect("team_id" in fields).toBe(false);
  });

  it("빈 context에서 빈 객체를 반환한다", () => {
    expect(correlation_fields({})).toEqual({});
  });

  it("모든 필드를 string으로 변환한다", () => {
    const fields = correlation_fields({ trace_id: "t", team_id: "team_1" });
    expect(typeof fields.trace_id).toBe("string");
    expect(typeof fields.team_id).toBe("string");
  });
});

// ── extract_correlation (RouteContext 통합) ──

describe("extract_correlation from RouteContext", () => {
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
    };
  }

  it("인증된 요청 → team_id, user_id 포함", () => {
    const ctx = make_route_ctx({ team_id: "team_1", user_id: "alice" });
    const corr = extract_correlation(ctx);
    expect(corr.trace_id).toBeTruthy();
    expect(corr.team_id).toBe("team_1");
    expect(corr.user_id).toBe("alice");
  });

  it("미인증 요청 → team_id, user_id 없음", () => {
    const ctx = make_route_ctx();
    const corr = extract_correlation(ctx);
    expect(corr.trace_id).toBeTruthy();
    expect(corr.team_id).toBeUndefined();
    expect(corr.user_id).toBeUndefined();
  });

  it("workspace_runtime 있으면 workspace_dir 포함", () => {
    const ctx = make_route_ctx({ team_id: "t1", user_id: "u1", workspace_path: "/ws/t1/u1" });
    const corr = extract_correlation(ctx);
    expect(corr.workspace_dir).toBe("/ws/t1/u1");
  });

  it("매 호출마다 새 trace_id 생성", () => {
    const ctx = make_route_ctx({ team_id: "t1", user_id: "u1" });
    const a = extract_correlation(ctx);
    const b = extract_correlation(ctx);
    expect(a.trace_id).not.toBe(b.trace_id);
  });
});
