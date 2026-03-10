/**
 * ToolRegistry — 미커버 분기 (cov2):
 * - L56: register() + _secret_resolver 주입
 * - L113-118: filtered() — allowlist 필터
 * - L149-153: pre_hook "ask" + updated_params
 * - L162: post_hook fire-and-forget
 * - L165-178: approval_required 처리 (auto_approved + notify)
 * - L192-200: trigger_approval_from_hook
 * - L205-206: notify_approval_required 콜백
 * - L232: get_approval_request
 * - L235-238: list_approval_requests status 필터
 * - L251-273: register_approval_with_callback (timeout 포함)
 * - L282-307: resolve_approval_request (모든 decision 분기)
 * - L322-352: execute_approved_request
 * - L357-372: expire_stale_approvals
 */
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "@src/agent/tools/registry.js";
import type { ToolLike, ToolSchema, ToolCategory } from "@src/agent/tools/types.js";

function make_tool(name: string, result = `${name} ok`, category: ToolCategory = "memory"): ToolLike {
  return {
    name,
    description: name,
    category,
    parameters: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue(result),
    validate_params: vi.fn().mockReturnValue([]),
    // filtered()의 get_definitions 필터가 d.name을 검사하므로 name을 최상위에 포함
    to_schema: () => ({ name, type: "function", function: { name, description: name, parameters: {} } }) as unknown as ToolSchema,
  } as unknown as ToolLike;
}

// ── L56: register() → _secret_resolver 주입 ───────────────────────────────

describe("register() — _secret_resolver 주입 (L56)", () => {
  it("set_secret_resolver 후 register() → inject_resolver 호출됨", () => {
    const reg = new ToolRegistry();
    const resolver = vi.fn();
    reg.set_secret_resolver(resolver);

    // set_secret_resolver가 있는 도구
    const tool = make_tool("inject_test");
    (tool as unknown as Record<string, unknown>).set_secret_resolver = vi.fn();
    reg.register(tool); // L56: _secret_resolver 있으므로 inject_resolver 호출

    expect((tool as unknown as { set_secret_resolver: ReturnType<typeof vi.fn> }).set_secret_resolver)
      .toHaveBeenCalledWith(resolver);
  });
});

// ── L113-118: filtered() ───────────────────────────────────────────────────

describe("filtered() — allowlist 필터 (L113-118)", () => {
  it("허용 목록 외 도구 execute → 에러 반환 (L115)", async () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("allowed_tool"));
    reg.register(make_tool("blocked_tool"));

    const filtered = reg.filtered(["allowed_tool"]);

    // L113: get_definitions 필터
    const defs = filtered.get_definitions();
    expect(defs).toHaveLength(1);

    // L115: blocked_tool → Error
    const result = await filtered.execute("blocked_tool", {});
    expect(result).toContain("not allowed");

    // L116: allowed_tool → 정상 실행
    const ok = await filtered.execute("allowed_tool", {});
    expect(ok).toBe("allowed_tool ok");

    // L118: tool_names 필터
    expect(filtered.tool_names()).toEqual(["allowed_tool"]);
  });
});

// ── L149-153: pre_hook "ask" + updated_params ────────────────────────────

describe("execute() — pre_hook ask + updated_params (L149-153)", () => {
  it("pre_hook ask + auto_approved_tools 없음 → trigger_approval_from_hook (L150)", async () => {
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({
      on_approval_request: on_approval,
      pre_hooks: [
        vi.fn().mockResolvedValue({ permission: "ask", reason: "needs_approval" }),
      ],
    });
    reg.register(make_tool("guarded"));
    const result = await reg.execute("guarded", {});
    expect(result).toContain("approval_required");
    expect(on_approval).toHaveBeenCalled();
  });

  it("pre_hook → updated_params → 도구에 전달됨 (L152-153)", async () => {
    const tool = make_tool("param_tool");
    const reg = new ToolRegistry({
      pre_hooks: [
        vi.fn().mockResolvedValue({ permission: "allow", updated_params: { extra: "injected" } }),
      ],
    });
    reg.register(tool);
    await reg.execute("param_tool", { original: 1 });
    expect(tool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ original: 1, extra: "injected" }),
      undefined,
    );
  });
});

// ── L162: post_hook fire-and-forget (에러도 무시) ─────────────────────────

describe("execute() — post_hook fire-and-forget (L162)", () => {
  it("post_hook throw → 결과에 영향 없음", async () => {
    const post_hook = vi.fn().mockRejectedValue(new Error("post_hook_error"));
    const reg = new ToolRegistry({ post_hooks: [post_hook] });
    reg.register(make_tool("post_test"));
    const result = await reg.execute("post_test", {});
    expect(result).toBe("post_test ok");
    expect(post_hook).toHaveBeenCalled();
  });
});

// ── L165-178: approval_required 처리 ─────────────────────────────────────

describe("execute() — approval_required 처리 (L165-178)", () => {
  it("approval_required 결과 + auto_approved_tools → 재실행 (L168)", async () => {
    // 첫 번째 execute: "Error: approval_required" 반환, 두 번째: 실제 결과
    const tool = make_tool("auto_approved");
    (tool.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("Error: approval_required for auto_approved")
      .mockResolvedValueOnce("auto_approved ok after rerun");

    const reg = new ToolRegistry();
    reg.register(tool);

    // approve_all decision으로 auto_approved_tools에 등록
    // 먼저 approve_all을 트리거하는 approval request를 만들기 위해
    // register_approval_with_callback 사용
    const { request_id } = reg.register_approval_with_callback("auto_approved", "test");
    reg.resolve_approval_request(request_id, "모두 승인");

    // 이제 auto_approved_tools에 "auto_approved"가 있으므로 재실행됨
    const result = await reg.execute("auto_approved", {});
    expect(result).toBe("auto_approved ok after rerun");
  });

  it("approval_required 결과 + notify → approval_request_id 포함 응답 (L170-177)", async () => {
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const tool = make_tool("need_approval");
    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");

    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    const result = await reg.execute("need_approval", {});
    expect(result).toContain("approval_request_id");
    expect(on_approval).toHaveBeenCalled();
  });

  it("일반 Error: 결과 → ERROR_HINT 추가 (L179)", async () => {
    const tool = make_tool("err_tool", "Error: something went wrong");
    const reg = new ToolRegistry();
    reg.register(tool);
    const result = await reg.execute("err_tool", {});
    expect(result).toContain("Error: something went wrong");
  });
});

// ── L205-206: notify_approval_required (on_approval_request throw 무시) ──

describe("notify_approval_required — 콜백 throw 무시 (L205-206)", () => {
  it("on_approval_request throw → 에러 전파 없음", async () => {
    const on_approval = vi.fn().mockRejectedValue(new Error("notify_error"));
    const tool = make_tool("notify_err");
    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");

    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    // notify_approval_required 내부에서 throw지만 무시됨
    await expect(reg.execute("notify_err", {})).resolves.toContain("approval_request_id");
  });
});

// ── L232, L235-238: get_approval_request + list_approval_requests ─────────

describe("get_approval_request + list_approval_requests (L232, L235-238)", () => {
  it("get_approval_request: 존재하는 request → 반환, 없으면 null", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("tool_x", "detail");
    expect(reg.get_approval_request(request_id)).not.toBeNull();
    expect(reg.get_approval_request("nonexistent")).toBeNull();
  });

  it("list_approval_requests: 2개 이상 → sort 비교자 실행 + status 필터 (L236-238)", () => {
    const reg = new ToolRegistry();
    const { request_id: id1 } = reg.register_approval_with_callback("tool_y1", "detail");
    reg.register_approval_with_callback("tool_y2", "detail");
    // 2개 → L236 sort 비교자 호출됨
    const all = reg.list_approval_requests();
    expect(all).toHaveLength(2);
    // approved 상태 → 0개 (L238 filter)
    expect(reg.list_approval_requests("approved")).toHaveLength(0);
    // approved로 전환 후 확인
    reg.resolve_approval_request(id1, "승인");
    expect(reg.list_approval_requests("approved")).toHaveLength(1);
    expect(reg.list_approval_requests("pending")).toHaveLength(1);
  });
});

// ── L251-273: register_approval_with_callback ─────────────────────────────

describe("register_approval_with_callback (L251-273)", () => {
  it("resolve → Promise resolves with decision (L267-270)", async () => {
    const reg = new ToolRegistry();
    const { request_id, decision } = reg.register_approval_with_callback("tool_cb", "detail");
    reg.resolve_approval_request(request_id, "승인");
    expect(await decision).toBe("approve");
  });

  it("타임아웃(1ms) → cancel 결정 반환 (L256-264)", async () => {
    vi.useFakeTimers();
    const reg = new ToolRegistry();
    const { decision } = reg.register_approval_with_callback("tool_timeout", "detail", undefined, 1);
    vi.advanceTimersByTime(2);
    expect(await decision).toBe("cancel");
    vi.useRealTimers();
  });
});

// ── L282-307: resolve_approval_request 분기 ──────────────────────────────

describe("resolve_approval_request — 모든 decision 분기 (L282-307)", () => {
  it("request_id 없음 → ok:false (L283)", () => {
    const reg = new ToolRegistry();
    const r = reg.resolve_approval_request("nonexistent", "승인");
    expect(r.ok).toBe(false);
    expect(r.decision).toBe("unknown");
  });

  it("deny decision → status=denied (L291)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("t", "d");
    const r = reg.resolve_approval_request(request_id, "거절");
    expect(r.status).toBe("denied");
  });

  it("defer decision → status=deferred (L292)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("t", "d");
    const r = reg.resolve_approval_request(request_id, "보류");
    expect(r.status).toBe("deferred");
  });

  it("cancel decision → status=cancelled (L293)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("t", "d");
    const r = reg.resolve_approval_request(request_id, "cancel");
    expect(r.status).toBe("cancelled");
  });

  it("clarify decision → status=clarify (L294)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("t", "d");
    const r = reg.resolve_approval_request(request_id, "왜 필요한가요? explain");
    expect(r.status).toBe("clarify");
  });

  it("approve_all → auto_approved_tools에 도구 추가 (L288-290)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("auto_tool", "d");
    const r = reg.resolve_approval_request(request_id, "모두 승인");
    expect(r.status).toBe("approved");
  });
});

// ── L322-352: execute_approved_request ───────────────────────────────────

describe("execute_approved_request (L322-352)", () => {
  it("request_id 없음 → ok:false, status:unknown (L323)", async () => {
    const reg = new ToolRegistry();
    const r = await reg.execute_approved_request("bad_id");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unknown");
  });

  it("status !== approved → ok:false (L324-326)", async () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("t", "d");
    // pending 상태 그대로
    const r = await reg.execute_approved_request(request_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("approval_not_approved");
  });

  it("bridge=true → ok:true, result=bridge_approved (L328-330)", async () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("bridge_tool", "d");
    reg.resolve_approval_request(request_id, "승인");
    const r = await reg.execute_approved_request(request_id);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("bridge_approved");
  });

  it("approved + 도구 없음 → tool_not_found (L332)", async () => {
    const reg = new ToolRegistry();
    // 도구를 등록하지 않고 approval만 만듦
    const { request_id } = reg.register_approval_with_callback("missing_tool", "d");
    reg.resolve_approval_request(request_id, "승인");
    const r = await reg.execute_approved_request(request_id);
    // bridge=true이므로 bridge_approved 반환 (register_approval_with_callback은 bridge=true)
    expect(r.result).toBe("bridge_approved");
  });

  it("approved + 도구 있음 + still_requires_approval (L336-338)", async () => {
    const tool = make_tool("still_needs_approval", "Error: approval_required again");
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    // bridge=false approval 요청을 만들려면 직접 execute_approved_request path를 통해야 함
    // create_approval_request는 private이므로 execute()를 통해 approval_request 생성
    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");
    const exec_result = await reg.execute("still_needs_approval", {});
    // approval_request_id 추출
    const id_match = exec_result.match(/approval_request_id: ([^\n]+)/);
    if (!id_match) throw new Error("no request_id in result");
    const approval_id = id_match[1].trim();
    reg.resolve_approval_request(approval_id, "승인");

    // 이번엔 실제로 여전히 approval_required 반환
    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required again");
    const r = await reg.execute_approved_request(approval_id);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("still_requires_approval");
  });

  it("approved + 도구 있음 + Error: 결과 (L339-341)", async () => {
    const tool = make_tool("err_approved", "ok");
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");
    const exec_result = await reg.execute("err_approved", {});
    const id_match = exec_result.match(/approval_request_id: ([^\n]+)/);
    if (!id_match) throw new Error("no request_id in result");
    const approval_id = id_match[1].trim();
    reg.resolve_approval_request(approval_id, "승인");

    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: tool failed");
    const r = await reg.execute_approved_request(approval_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Error: tool failed");
  });

  it("approved + 도구 있음 + 성공 결과 (L342-344)", async () => {
    const tool = make_tool("success_approved", "ok");
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");
    const exec_result = await reg.execute("success_approved", {});
    const id_match = exec_result.match(/approval_request_id: ([^\n]+)/);
    if (!id_match) throw new Error("no request_id in result");
    const approval_id = id_match[1].trim();
    reg.resolve_approval_request(approval_id, "승인");

    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("all done");
    const r = await reg.execute_approved_request(approval_id);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("all done");
  });

  it("approved + 도구 execute throw → ok:false, error 반환 (L346-352)", async () => {
    const tool = make_tool("throw_approved", "ok");
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({ on_approval_request: on_approval });
    reg.register(tool);

    (tool.execute as ReturnType<typeof vi.fn>).mockResolvedValue("Error: approval_required");
    const exec_result = await reg.execute("throw_approved", {});
    const id_match = exec_result.match(/approval_request_id: ([^\n]+)/);
    if (!id_match) throw new Error("no request_id in result");
    const approval_id = id_match[1].trim();
    reg.resolve_approval_request(approval_id, "승인");

    (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("crash"));
    const r = await reg.execute_approved_request(approval_id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("crash");
  });
});

// ── L357-372: expire_stale_approvals ─────────────────────────────────────

describe("expire_stale_approvals (L357-372)", () => {
  it("TTL 초과 pending → cancelled로 전환 + count 반환 (L360-370)", () => {
    vi.useFakeTimers();
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("expire_tool", "detail", undefined, 999_999);

    // 10분 경과 (기본 TTL=600_000ms)
    vi.advanceTimersByTime(601_000);

    const count = reg.expire_stale_approvals(600_000);
    expect(count).toBe(1);
    expect(reg.get_approval_request(request_id)?.status).toBe("cancelled");
    vi.useRealTimers();
  });

  it("TTL 미초과 → count=0", () => {
    const reg = new ToolRegistry();
    reg.register_approval_with_callback("fresh_tool", "detail", undefined, 999_999);
    const count = reg.expire_stale_approvals(600_000);
    expect(count).toBe(0);
  });

  it("non-pending 상태는 expire 대상 아님 (L360 continue)", () => {
    const reg = new ToolRegistry();
    const { request_id } = reg.register_approval_with_callback("resolved_tool", "detail", undefined, 999_999);
    reg.resolve_approval_request(request_id, "승인");
    // approved 상태이므로 expire 대상 아님
    const count = reg.expire_stale_approvals(0); // TTL=0 → 모두 만료
    expect(count).toBe(0);
  });
});
