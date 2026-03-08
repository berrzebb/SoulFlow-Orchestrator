/**
 * DecisionTool, PromiseTool (PolicyTool 공통 기반) — 전 경로 테스트.
 * list/set/get_effective/에러 경로, 빈 결과 레이블.
 */
import { describe, it, expect, vi } from "vitest";
import { DecisionTool } from "../../../src/agent/tools/decision-tool.js";
import { PromiseTool } from "../../../src/agent/tools/promise-tool.js";
import type { PolicyStoreLike } from "../../../src/agent/tools/policy-tool.js";

function make_store(overrides: Partial<PolicyStoreLike> = {}): PolicyStoreLike {
  return {
    list: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue({ action: "created", record: { value: "v1" } }),
    get_effective: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function make_decision_tool(store?: Partial<PolicyStoreLike>): DecisionTool {
  const svc: any = {
    list_decisions: make_store(store).list,
    append_decision: make_store(store).append,
    get_effective_decisions: make_store(store).get_effective,
  };
  return new DecisionTool(svc);
}

// ══════════════════════════════════════════
// DecisionTool
// ══════════════════════════════════════════

describe("DecisionTool — list", () => {
  it("빈 목록 → empty_list 레이블", async () => {
    const t = make_decision_tool();
    const r = await (t as any).run({ action: "list" });
    expect(r).toContain("없음");
  });

  it("결과 있음 → key=value 형식", async () => {
    const svc: any = {
      list_decisions: vi.fn().mockResolvedValue([{ priority: 5, canonical_key: "k1", value: "v1" }]),
      append_decision: vi.fn(),
      get_effective_decisions: vi.fn(),
    };
    const t = new DecisionTool(svc);
    const r = await (t as any).run({ action: "list" });
    expect(r).toContain("k1");
    expect(r).toContain("v1");
  });

  it("limit/key/search 파라미터 전달", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const svc: any = { list_decisions: list, append_decision: vi.fn(), get_effective_decisions: vi.fn() };
    const t = new DecisionTool(svc);
    await (t as any).run({ action: "list", limit: 5, key: "foo", search: "bar" });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, key: "foo", search: "bar" }));
  });
});

describe("DecisionTool — set", () => {
  it("key+value → 생성 성공", async () => {
    const svc: any = {
      list_decisions: vi.fn(),
      append_decision: vi.fn().mockResolvedValue({ action: "created", record: { value: "important" } }),
      get_effective_decisions: vi.fn(),
    };
    const t = new DecisionTool(svc);
    const r = await (t as any).run({ action: "set", key: "my_key", value: "important", scope: "global" });
    expect(r).toContain("결정");
    expect(r).toContain("created");
  });

  it("key 없음 → Error 반환", async () => {
    const t = make_decision_tool();
    const r = await (t as any).run({ action: "set", value: "v" });
    expect(r).toContain("Error");
  });

  it("value 없음 → Error 반환", async () => {
    const t = make_decision_tool();
    const r = await (t as any).run({ action: "set", key: "k" });
    expect(r).toContain("Error");
  });
});

describe("DecisionTool — get_effective", () => {
  it("빈 목록 → empty_effective 레이블", async () => {
    const t = make_decision_tool();
    const r = await (t as any).run({ action: "get_effective" });
    expect(r).toContain("없음");
  });

  it("결과 있음 → scope/key/value 포함", async () => {
    const svc: any = {
      list_decisions: vi.fn(),
      append_decision: vi.fn(),
      get_effective_decisions: vi.fn().mockResolvedValue([{ priority: 3, scope: "global", canonical_key: "gk1", value: "gv1" }]),
    };
    const t = new DecisionTool(svc);
    const r = await (t as any).run({ action: "get_effective" });
    expect(r).toContain("gk1");
    expect(r).toContain("global");
  });
});

describe("DecisionTool — unknown action", () => {
  it("알 수 없는 action → Error 반환", async () => {
    const t = make_decision_tool();
    const r = await (t as any).run({ action: "invalid" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid");
  });
});

// ══════════════════════════════════════════
// PromiseTool
// ══════════════════════════════════════════

describe("PromiseTool — list 빈 결과 레이블", () => {
  it("빈 목록 → 약속 없음 레이블", async () => {
    const svc: any = {
      list_promises: vi.fn().mockResolvedValue([]),
      append_promise: vi.fn(),
      get_effective_promises: vi.fn(),
    };
    const t = new PromiseTool(svc);
    const r = await (t as any).run({ action: "list" });
    expect(r).toContain("없음");
  });

  it("set action → 약속 생성", async () => {
    const svc: any = {
      list_promises: vi.fn(),
      append_promise: vi.fn().mockResolvedValue({ action: "created", record: { value: "keep secret" } }),
      get_effective_promises: vi.fn(),
    };
    const t = new PromiseTool(svc);
    const r = await (t as any).run({ action: "set", key: "secret_key", value: "keep secret" });
    expect(r).toContain("약속");
    expect(r).toContain("created");
  });
});

// ══════════════════════════════════════════
// tool metadata
// ══════════════════════════════════════════

describe("DecisionTool / PromiseTool — metadata", () => {
  it("DecisionTool.name = 'decision'", () => {
    const svc: any = { list_decisions: vi.fn(), append_decision: vi.fn(), get_effective_decisions: vi.fn() };
    expect(new DecisionTool(svc).name).toBe("decision");
  });

  it("PromiseTool.name = 'promise'", () => {
    const svc: any = { list_promises: vi.fn(), append_promise: vi.fn(), get_effective_promises: vi.fn() };
    expect(new PromiseTool(svc).name).toBe("promise");
  });
});
