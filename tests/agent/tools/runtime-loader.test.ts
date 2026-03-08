/**
 * DynamicToolRuntimeLoader / ToolRuntimeReloader 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamicToolRuntimeLoader, ToolRuntimeReloader } from "@src/agent/tools/runtime-loader.js";

// Mock store
function make_store(tools: unknown[] = [], sig = "abc123") {
  return {
    list_tools: vi.fn().mockReturnValue(tools),
    signature: vi.fn().mockReturnValue(sig),
  } as any;
}

// Mock registry
function make_registry() {
  return {
    set_dynamic_tools: vi.fn(),
  } as any;
}

// ══════════════════════════════════════════
// DynamicToolRuntimeLoader
// ══════════════════════════════════════════

describe("DynamicToolRuntimeLoader — 기본 동작", () => {
  it("store 없음 → SqliteDynamicToolStore 자동 생성", () => {
    // 실제 DB 없이 생성만 테스트
    const loader = new DynamicToolRuntimeLoader("/tmp/workspace");
    expect(loader.workspace).toBe("/tmp/workspace");
    expect(loader.store_path).toContain("tools.db");
  });

  it("store_path 오버라이드", () => {
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", "/tmp/custom/tools.db");
    expect(loader.store_path).toBe("/tmp/custom/tools.db");
  });

  it("store 오버라이드 → 직접 사용", () => {
    const store = make_store();
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    expect(loader.store).toBe(store);
  });

  it("load_tools() → enabled=true, kind=shell 필터링", () => {
    const store = make_store([
      { enabled: true, kind: "shell", name: "tool1", command: "echo" },
      { enabled: false, kind: "shell", name: "tool2", command: "ls" },
      { enabled: true, kind: "http", name: "tool3" }, // http → 필터
    ]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const tools = loader.load_tools();
    // shell + enabled만 → 1개
    expect(tools).toHaveLength(1);
  });

  it("load_tools() → 빈 배열", () => {
    const store = make_store([]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const tools = loader.load_tools();
    expect(tools).toEqual([]);
  });

  it("signature() → store.signature() 위임", () => {
    const store = make_store([], "sig-123");
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    expect(loader.signature()).toBe("sig-123");
  });
});

// ══════════════════════════════════════════
// ToolRuntimeReloader
// ══════════════════════════════════════════

describe("ToolRuntimeReloader — reload_now", () => {
  it("reload_now → set_dynamic_tools 호출, 도구 수 반환", () => {
    const store = make_store([
      { enabled: true, kind: "shell", name: "t1", command: "echo" },
    ]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    const count = reloader.reload_now();
    expect(count).toBe(1);
    expect(registry.set_dynamic_tools).toHaveBeenCalledOnce();
  });
});

describe("ToolRuntimeReloader — start/stop", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("start → reload_now 즉시 호출, setInterval 시작", () => {
    const store = make_store([]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    reloader.start(1000);
    expect(registry.set_dynamic_tools).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    // 시그니처가 같으면 reload 안 함
    expect(registry.set_dynamic_tools).toHaveBeenCalledTimes(1);
    reloader.stop();
    vi.useRealTimers();
  });

  it("시그니처 변경 → reload 트리거", () => {
    let call_count = 0;
    const store = {
      list_tools: vi.fn().mockReturnValue([]),
      signature: vi.fn().mockImplementation(() => `sig-${call_count++}`),
    } as any;
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    reloader.start(1000);
    expect(registry.set_dynamic_tools).toHaveBeenCalledTimes(1); // 초기 reload
    vi.advanceTimersByTime(1100); // 인터벌 발동 + 시그니처 변경
    expect(registry.set_dynamic_tools).toHaveBeenCalledTimes(2); // reload 발생
    reloader.stop();
    vi.useRealTimers();
  });

  it("stop 후 타이머 정지", () => {
    const store = {
      list_tools: vi.fn().mockReturnValue([]),
      signature: vi.fn().mockImplementation(() => `sig-${Math.random()}`),
    } as any;
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    reloader.start(500);
    reloader.stop();
    const count_after_stop = (registry.set_dynamic_tools as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(registry.set_dynamic_tools).toHaveBeenCalledTimes(count_after_stop);
    vi.useRealTimers();
  });

  it("start 중복 호출 → 두 번째는 무시", () => {
    const store = make_store([]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    reloader.start(1000);
    reloader.start(1000); // 두 번째 → 무시
    const calls_after = (registry.set_dynamic_tools as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls_after).toBe(1);
    reloader.stop();
    vi.useRealTimers();
  });

  it("stop 중복 호출 → 오류 없음", () => {
    const store = make_store([]);
    const loader = new DynamicToolRuntimeLoader("/tmp/ws", undefined, store);
    const registry = make_registry();
    const reloader = new ToolRuntimeReloader(loader, registry);
    reloader.stop(); // 시작 전 stop
    reloader.start(1000);
    reloader.stop();
    reloader.stop(); // 중복 stop
    vi.useRealTimers();
  });
});
