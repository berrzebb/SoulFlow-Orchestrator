/**
 * Dashboard 소규모 유틸리티 모듈 커버리지.
 * create_tool_ops, create_memory_ops, set_no_cache, OrchestratorLlmServiceAdapter.
 */
import { describe, it, expect, vi } from "vitest";
import { create_tool_ops } from "@src/dashboard/ops/tool.js";
import { create_memory_ops } from "@src/dashboard/ops/memory.js";
import { set_no_cache } from "@src/dashboard/route-context.js";
import { OrchestratorLlmServiceAdapter } from "@src/providers/orchestrator-llm-service.adapter.js";

// ══════════════════════════════════════════
// create_tool_ops
// ══════════════════════════════════════════

describe("create_tool_ops", () => {
  function make_mcp() {
    return {
      list_servers: vi.fn().mockReturnValue([
        { name: "mcp-test", connected: true, tools: [{ name: "tool1" }, { name: "tool2" }], error: undefined },
        { name: "mcp-fail", connected: false, tools: [], error: "connection refused" },
      ]),
    };
  }

  it("tool_names() → deps 위임", () => {
    const deps = { tool_names: vi.fn().mockReturnValue(["t1", "t2"]), get_definitions: vi.fn().mockReturnValue([]), mcp: make_mcp() };
    const ops = create_tool_ops(deps);
    expect(ops.tool_names()).toEqual(["t1", "t2"]);
    expect(deps.tool_names).toHaveBeenCalledOnce();
  });

  it("get_definitions() → deps 위임", () => {
    const defs = [{ name: "d1" }];
    const deps = { tool_names: vi.fn().mockReturnValue([]), get_definitions: vi.fn().mockReturnValue(defs), mcp: make_mcp() };
    const ops = create_tool_ops(deps);
    expect(ops.get_definitions()).toEqual(defs);
  });

  it("list_mcp_servers() → mcp.list_servers() 매핑", () => {
    const deps = { tool_names: vi.fn().mockReturnValue([]), get_definitions: vi.fn().mockReturnValue([]), mcp: make_mcp() };
    const ops = create_tool_ops(deps);
    const servers = ops.list_mcp_servers();
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({ name: "mcp-test", connected: true, tools: ["tool1", "tool2"] });
    expect(servers[1]).toMatchObject({ name: "mcp-fail", connected: false, tools: [], error: "connection refused" });
  });
});

// ══════════════════════════════════════════
// create_memory_ops
// ══════════════════════════════════════════

describe("create_memory_ops", () => {
  function make_store() {
    return {
      read_longterm: vi.fn().mockResolvedValue("longterm"),
      write_longterm: vi.fn().mockResolvedValue(undefined),
      list_daily: vi.fn().mockResolvedValue(["2026-01-01"]),
      read_daily: vi.fn().mockResolvedValue("daily"),
      write_daily: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    };
  }

  it("read_longterm → store 위임", async () => {
    const store = make_store();
    const ops = create_memory_ops(store);
    const r = await ops.read_longterm();
    expect(r).toBe("longterm");
    expect(store.read_longterm).toHaveBeenCalledOnce();
  });

  it("write_longterm → store 위임", async () => {
    const store = make_store();
    const ops = create_memory_ops(store);
    await ops.write_longterm("new content");
    expect(store.write_longterm).toHaveBeenCalledWith("new content");
  });

  it("list_daily → store 위임", async () => {
    const store = make_store();
    const ops = create_memory_ops(store);
    expect(await ops.list_daily()).toEqual(["2026-01-01"]);
  });

  it("read_daily → store 위임", async () => {
    const store = make_store();
    const ops = create_memory_ops(store);
    const r = await ops.read_daily("2026-01-01");
    expect(r).toBe("daily");
    expect(store.read_daily).toHaveBeenCalledWith("2026-01-01");
  });

  it("write_daily → store 위임", async () => {
    const store = make_store();
    const ops = create_memory_ops(store);
    await ops.write_daily("content", "2026-01-01");
    expect(store.write_daily).toHaveBeenCalledWith("content", "2026-01-01");
  });
});

// ══════════════════════════════════════════
// set_no_cache
// ══════════════════════════════════════════

describe("set_no_cache", () => {
  it("Cache-Control, Pragma, Expires 헤더 설정", () => {
    const headers = new Map<string, string>();
    const res = { setHeader: (k: string, v: string) => headers.set(k, v) } as any;
    set_no_cache(res);
    expect(headers.get("Cache-Control")).toContain("no-store");
    expect(headers.get("Pragma")).toBe("no-cache");
    expect(headers.get("Expires")).toBe("0");
  });
});

// ══════════════════════════════════════════
// OrchestratorLlmServiceAdapter
// ══════════════════════════════════════════

describe("OrchestratorLlmServiceAdapter", () => {
  function make_inner(overrides: Record<string, any> = {}) {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      health_check: vi.fn().mockResolvedValue({
        running: true, enabled: true, engine: "llama.cpp",
        model: "mistral", model_loaded: true, gpu_percent: 80,
      }),
      ...overrides,
    };
  }

  it("name = 'orchestrator-llm-runtime'", () => {
    const adapter = new OrchestratorLlmServiceAdapter(make_inner() as any);
    expect(adapter.name).toBe("orchestrator-llm-runtime");
  });

  it("start() → inner.start() 호출", async () => {
    const inner = make_inner();
    const adapter = new OrchestratorLlmServiceAdapter(inner as any);
    await adapter.start();
    expect(inner.start).toHaveBeenCalledOnce();
  });

  it("stop() → inner.stop() 호출", async () => {
    const inner = make_inner();
    const adapter = new OrchestratorLlmServiceAdapter(inner as any);
    await adapter.stop();
    expect(inner.stop).toHaveBeenCalledOnce();
  });

  it("health_check() → ok=running, details 매핑", async () => {
    const adapter = new OrchestratorLlmServiceAdapter(make_inner() as any);
    const result = await adapter.health_check();
    expect(result.ok).toBe(true);
    expect(result.details?.engine).toBe("llama.cpp");
    expect(result.details?.gpu_percent).toBe(80);
  });

  it("health_check() — running=false → ok=false", async () => {
    const inner = make_inner({ health_check: vi.fn().mockResolvedValue({ running: false, enabled: true, engine: "llama.cpp", model: null, model_loaded: false, gpu_percent: 0 }) });
    const adapter = new OrchestratorLlmServiceAdapter(inner as any);
    const result = await adapter.health_check();
    expect(result.ok).toBe(false);
  });
});
