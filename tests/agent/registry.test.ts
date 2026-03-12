/**
 * ToolRegistry 승인 워크플로우 + 시크릿 리졸버 + 만료 처리 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "@src/agent/tools/registry.js";
import type { ToolLike, ToolSchema, JsonSchema } from "@src/agent/tools/types.js";
import type { ApprovalDecision } from "@src/agent/tools/approval-parser.js";

function make_tool(
  name: string,
  handler: (params: Record<string, unknown>) => string | Promise<string>,
): ToolLike {
  return {
    name,
    description: name,
    category: "test",
    parameters: { type: "object" } as JsonSchema,
    execute: async (params: Record<string, unknown>) => handler(params),
    validate_params: () => [],
    to_schema: () =>
      ({ type: "function", function: { name, description: name, parameters: {} } }) as ToolSchema,
  };
}

function make_approval_tool(name: string): ToolLike {
  return make_tool(name, (params) => {
    if (!params.__approved) return "Error: approval_required\nreason: needs_approval";
    return `${name}_approved_result`;
  });
}

function extract_req_id(result: string): string {
  return result.match(/approval_request_id: ([^\n]+)/)?.[1]?.trim() ?? "";
}

describe("ToolRegistry — 승인 워크플로우", () => {
  it("resolve_approval_request: unknown request_id → ok=false", () => {
    const reg = new ToolRegistry();
    const r = reg.resolve_approval_request("nonexistent-id", "승인");
    expect(r.ok).toBe(false);
    expect(r.decision).toBe("unknown");
  });

  it("resolve_approval_request: approve → status=approved", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("safe_tool"));
    const result = await reg.execute("safe_tool", {});
    const req_id = extract_req_id(result);
    expect(req_id).toBeTruthy();
    const r = reg.resolve_approval_request(req_id, "승인");
    expect(r.ok).toBe(true);
    expect(r.decision).toBe("approve");
    expect(r.status).toBe("approved");
  });

  it("resolve_approval_request: approve_all → 이후 자동 실행", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("repeatable_tool"));
    const first = await reg.execute("repeatable_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "모두 승인");
    const result2 = await reg.execute("repeatable_tool", {});
    expect(result2).toBe("repeatable_tool_approved_result");
  });

  it("resolve_approval_request: deny → status=denied", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("guarded_tool"));
    const exec_result = await reg.execute("guarded_tool", {});
    const req_id = extract_req_id(exec_result);
    expect(req_id).toBeTruthy();
    const r = reg.resolve_approval_request(req_id, "거절");
    expect(r.decision).toBe("deny");
    expect(r.status).toBe("denied");
  });

  it("resolve_approval_request: defer → status=deferred", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("slow_tool"));
    const exec_result = await reg.execute("slow_tool", {});
    const req_id = extract_req_id(exec_result);
    const r = reg.resolve_approval_request(req_id, "보류");
    expect(r.status).toBe("deferred");
  });

  it("execute_approved_request: unknown request_id → error", async () => {
    const reg = new ToolRegistry();
    const r = await reg.execute_approved_request("not-a-real-id");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unknown");
    expect(r.error).toBe("approval_request_not_found");
  });

  it("execute_approved_request: not approved → error with status", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("pending_tool"));
    const first = await reg.execute("pending_tool", {});
    const req_id = extract_req_id(first);
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("approval_not_approved");
  });

  it("execute_approved_request: approved → 도구 실행 결과 반환", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("exec_tool"));
    const first = await reg.execute("exec_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "승인");
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("exec_tool_approved_result");
  });

  it("execute_approved_request: bridge mode → bridge_approved 반환", async () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("some_tool", "needs approval");
    reg.resolve_approval_request(request_id, "승인");
    const r = await reg.execute_approved_request(request_id);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("bridge_approved");
  });

  it("execute_approved_request: tool not found after approval → error", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("vanishing_tool"));
    const first = await reg.execute("vanishing_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "승인");
    reg.unregister("vanishing_tool");
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("tool_not_found");
  });

  it("execute_approved_request: 도구가 여전히 approval_required → still_requires_approval", async () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("stubborn_tool", () => "Error: approval_required\nstill needed"));
    const first = await reg.execute("stubborn_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "승인");
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("still_requires_approval");
  });

  it("execute_approved_request: 도구 예외 throw → error 반환", async () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("throwing_tool", (p) => {
      if (p.__approved) throw new Error("runtime error");
      return "Error: approval_required";
    }));
    const first = await reg.execute("throwing_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "승인");
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("runtime error");
  });

  it("execute_approved_request: 도구가 Error: 반환 → ok=false", async () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("error_result_tool", (p) => {
      if (p.__approved) return "Error: something failed";
      return "Error: approval_required";
    }));
    const first = await reg.execute("error_result_tool", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "승인");
    const r = await reg.execute_approved_request(req_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Error: something failed");
  });
});

describe("ToolRegistry — expire_stale_approvals", () => {
  it("만료된 pending 요청을 cancelled로 전환하고 count 반환", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("old_tool"));
    await reg.execute("old_tool", {});
    const count = reg.expire_stale_approvals(0);
    expect(count).toBe(1);
    const cancelled = reg.list_approval_requests("cancelled");
    expect(cancelled).toHaveLength(1);
  });

  it("이미 처리된(denied) 요청은 만료 대상에서 제외", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("old_tool2"));
    const exec = await reg.execute("old_tool2", {});
    const req_id = extract_req_id(exec);
    reg.resolve_approval_request(req_id, "거절");
    const count = reg.expire_stale_approvals(0);
    expect(count).toBe(0);
  });

  it("만료 시 콜백이 있으면 cancel로 호출", async () => {
    const reg = new ToolRegistry();
    const { decision } = reg.register_approval_with_callback("cb_tool", "test", undefined, 10000);
    let resolved_decision: ApprovalDecision | undefined;
    void decision.then((d: ApprovalDecision) => { resolved_decision = d; });
    reg.expire_stale_approvals(0);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(resolved_decision).toBe("cancel");
  });
});

describe("ToolRegistry — register_approval_with_callback", () => {
  it("timeout 후 cancel로 resolve됨", async () => {
    const reg = new ToolRegistry();
    const { decision } = reg.register_approval_with_callback("timeout_tool", "needs approval", undefined, 10);
    const d = await decision;
    expect(d).toBe("cancel");
  });

  it("resolve_approval_request 호출 시 콜백 즉시 resolve", async () => {
    const reg = new ToolRegistry();
    const { request_id, decision } = reg.register_approval_with_callback("quick_tool", "test", undefined, 10000);
    reg.resolve_approval_request(request_id, "승인");
    const d = await decision;
    expect(d).toBe("approve");
  });
});

describe("ToolRegistry — set_dynamic_tools + secret_resolver", () => {
  it("set_dynamic_tools: 기존 동적 도구 교체 후 새 도구만 등록", () => {
    const reg = new ToolRegistry();
    reg.set_dynamic_tools([make_tool("dyn_a", () => "a"), make_tool("dyn_b", () => "b")]);
    expect(reg.has("dyn_a")).toBe(true);
    reg.set_dynamic_tools([make_tool("dyn_c", () => "c")]);
    expect(reg.has("dyn_a")).toBe(false);
    expect(reg.has("dyn_c")).toBe(true);
  });

  it("set_secret_resolver: 등록 시 도구에 resolver 주입", () => {
    const reg = new ToolRegistry();
    const resolver = vi.fn().mockResolvedValue("secret_value");
    reg.set_secret_resolver(resolver);
    const injected_tool = {
      ...make_tool("injectable", () => "ok"),
      set_secret_resolver: vi.fn(),
    };
    reg.register(injected_tool as ToolLike);
    expect(injected_tool.set_secret_resolver).toHaveBeenCalledWith(resolver);
  });

  it("get_all: 등록된 모든 도구 반환", () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("t1", () => "1"));
    reg.register(make_tool("t2", () => "2"));
    expect(reg.get_all()).toHaveLength(2);
  });

  it("build_category_map: 도구명 → 카테고리 매핑 반환", () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("cat_tool", () => "x"));
    const map = reg.build_category_map();
    expect(map["cat_tool"]).toBe("test");
  });
});

describe("ToolRegistry — pre/post hooks", () => {
  it("pre hook deny → 실행 차단", async () => {
    const reg = new ToolRegistry({
      pre_hooks: [
        (
          _name: string,
          _params: Record<string, unknown>,
        ) => ({ permission: "deny" as const, reason: "blocked_by_policy" }),
      ],
    });
    reg.register(make_tool("blocked", () => "should not run"));
    const result = await reg.execute("blocked", {});
    expect(result).toContain("denied by policy");
    expect(result).toContain("blocked_by_policy");
  });

  it("pre hook ask → approval_required 흐름 시작", async () => {
    const reg = new ToolRegistry({
      pre_hooks: [
        (
          _name: string,
          _params: Record<string, unknown>,
        ) => ({ permission: "ask" as const, reason: "hook_asks_approval" }),
      ],
    });
    reg.register(make_tool("ask_tool", () => "ok"));
    const result = await reg.execute("ask_tool", {});
    expect(result).toContain("approval_required");
    expect(result).toContain("approval_request_id");
  });

  it("pre hook updated_params → 파라미터 변경 후 실행", async () => {
    const reg = new ToolRegistry({
      pre_hooks: [
        (
          _name: string,
          params: Record<string, unknown>,
        ) => ({ permission: "allow" as const, updated_params: { ...params, injected: "yes" } }),
      ],
    });
    reg.register(make_tool("param_tool", (p) => `injected=${p.injected}`));
    const result = await reg.execute("param_tool", {});
    expect(result).toBe("injected=yes");
  });

  it("post hook 실행 오류는 무시됨 (fire-and-forget)", async () => {
    const reg = new ToolRegistry({
      post_hooks: [async () => { throw new Error("post hook error"); }],
    });
    reg.register(make_tool("safe_tool2", () => "done"));
    const result = await reg.execute("safe_tool2", {});
    expect(result).toBe("done");
  });

  it("auto_approved tool은 ask hook에서 바이패스", async () => {
    const reg = new ToolRegistry({
      pre_hooks: [
        (
          _name: string,
          _params: Record<string, unknown>,
        ) => ({ permission: "ask" as const }),
      ],
    });
    reg.register(make_approval_tool("auto_app"));
    const first = await reg.execute("auto_app", {});
    const req_id = extract_req_id(first);
    reg.resolve_approval_request(req_id, "모두 승인");
    const result = await reg.execute("auto_app", {});
    expect(result).toBe("auto_app_approved_result");
  });

  it("list_approval_requests: status 필터링 없이 전체 반환", async () => {
    const reg = new ToolRegistry();
    reg.register(make_approval_tool("list_tool"));
    await reg.execute("list_tool", {});
    const all = reg.list_approval_requests();
    expect(all).toHaveLength(1);
  });
});
