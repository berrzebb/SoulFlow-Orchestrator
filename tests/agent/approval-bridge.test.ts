/**
 * ToolRegistry 승인 브리지 테스트.
 * register_approval_with_callback → resolve_approval_request 플로우.
 * 타임아웃, 콜백 해제, 상태 전환 검증.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "@src/agent/tools/registry.js";

describe("ToolRegistry — register_approval_with_callback", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new ToolRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("approval 요청을 등록하고 request_id를 반환한다", () => {
    const { request_id, decision } = registry.register_approval_with_callback(
      "exec", "rm -rf /tmp/test", { task_id: "t1", channel: "telegram", chat_id: "c1", sender_id: "u1" },
    );

    expect(request_id).toBeTruthy();
    expect(typeof request_id).toBe("string");
    expect(decision).toBeInstanceOf(Promise);
  });

  it("pending 상태의 approval 요청이 생성된다", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test command");

    const req = registry.get_approval_request(request_id);
    expect(req).toBeTruthy();
    expect(req!.status).toBe("pending");
    expect(req!.tool_name).toBe("exec");
    expect(req!.bridge).toBe(true);
  });

  it("resolve로 approve하면 Promise가 'approve'로 resolve된다", async () => {
    const { request_id, decision } = registry.register_approval_with_callback("exec", "safe command");

    const result = registry.resolve_approval_request(request_id, "yes");
    expect(result.ok).toBe(true);
    expect(result.decision).toBe("approve");
    expect(result.status).toBe("approved");

    const resolved = await decision;
    expect(resolved).toBe("approve");
  });

  it("resolve로 deny하면 Promise가 'deny'로 resolve된다", async () => {
    const { request_id, decision } = registry.register_approval_with_callback("exec", "dangerous");

    registry.resolve_approval_request(request_id, "no");

    const resolved = await decision;
    expect(resolved).toBe("deny");
  });

  it("resolve로 defer하면 Promise가 'defer'로 resolve된다", async () => {
    const { request_id, decision } = registry.register_approval_with_callback("exec", "test");

    registry.resolve_approval_request(request_id, "보류");

    const resolved = await decision;
    expect(resolved).toBe("defer");
  });

  it("타임아웃 시 Promise가 'cancel'로 resolve된다", async () => {
    const { request_id, decision } = registry.register_approval_with_callback(
      "exec", "test", undefined, 5000, // 5초 타임아웃
    );

    // 타임아웃 전 — 아직 pending
    expect(registry.get_approval_request(request_id)!.status).toBe("pending");

    // 타임아웃 경과
    vi.advanceTimersByTime(5001);

    const resolved = await decision;
    expect(resolved).toBe("cancel");

    // 상태가 cancelled로 변경됨
    expect(registry.get_approval_request(request_id)!.status).toBe("cancelled");
  });

  it("resolve 후 타임아웃이 해제된다 (이중 resolve 방지)", async () => {
    const { request_id, decision } = registry.register_approval_with_callback(
      "exec", "test", undefined, 5000,
    );

    // 타임아웃 전에 resolve
    registry.resolve_approval_request(request_id, "yes");
    const resolved = await decision;
    expect(resolved).toBe("approve");

    // 타임아웃 경과해도 상태가 변하지 않음
    vi.advanceTimersByTime(6000);
    expect(registry.get_approval_request(request_id)!.status).toBe("approved");
  });

  it("존재하지 않는 request_id로 resolve하면 ok=false", () => {
    const result = registry.resolve_approval_request("nonexistent", "yes");
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("unknown");
  });

  it("on_approval_request 콜백이 호출된다", async () => {
    const on_approval = vi.fn().mockResolvedValue(undefined);
    const reg = new ToolRegistry({ on_approval_request: on_approval });

    reg.register_approval_with_callback("exec", "test command");

    // 비동기 콜백이므로 microtask 대기
    await vi.advanceTimersByTimeAsync(0);

    expect(on_approval).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: "exec",
        detail: "test command",
        status: "pending",
        bridge: true,
      }),
    );
  });

  it("여러 approval 요청을 동시에 처리할 수 있다", async () => {
    const result1 = registry.register_approval_with_callback("exec", "cmd1");
    const result2 = registry.register_approval_with_callback("write_file", "cmd2");

    expect(result1.request_id).not.toBe(result2.request_id);

    registry.resolve_approval_request(result1.request_id, "yes");
    registry.resolve_approval_request(result2.request_id, "no");

    expect(await result1.decision).toBe("approve");
    expect(await result2.decision).toBe("deny");
  });

  it("list_approval_requests가 상태별로 필터링된다", () => {
    const r1 = registry.register_approval_with_callback("exec", "cmd1");
    const r2 = registry.register_approval_with_callback("exec", "cmd2");
    const r3 = registry.register_approval_with_callback("exec", "cmd3");

    registry.resolve_approval_request(r1.request_id, "yes");
    registry.resolve_approval_request(r2.request_id, "no");

    const pending = registry.list_approval_requests("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].request_id).toBe(r3.request_id);

    const approved = registry.list_approval_requests("approved");
    expect(approved.length).toBe(1);

    const denied = registry.list_approval_requests("denied");
    expect(denied.length).toBe(1);
  });
});

describe("ToolRegistry — resolve_approval_request 상태 전환", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("approve → approved", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "승인");
    expect(result.status).toBe("approved");
    expect(result.decision).toBe("approve");
  });

  it("deny → denied", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "거절");
    expect(result.status).toBe("denied");
  });

  it("defer → deferred", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "later");
    expect(result.status).toBe("deferred");
  });

  it("cancel → cancelled", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "cancel");
    expect(result.status).toBe("cancelled");
  });

  it("clarify → clarify", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "왜?");
    expect(result.status).toBe("clarify");
  });

  it("unknown 텍스트 → pending (상태 유지)", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    const result = registry.resolve_approval_request(request_id, "날씨가 좋네요");
    expect(result.status).toBe("pending");
    expect(result.ok).toBe(false);
  });

  it("response_text와 response_parsed가 저장된다", () => {
    const { request_id } = registry.register_approval_with_callback("exec", "test");
    registry.resolve_approval_request(request_id, "yes please");

    const req = registry.get_approval_request(request_id);
    expect(req!.response_text).toBe("yes please");
    expect(req!.response_parsed).toBeTruthy();
    expect(req!.response_parsed!.decision).toBe("approve");
  });
});
