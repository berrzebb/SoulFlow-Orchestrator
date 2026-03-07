import { describe, it, expect, vi } from "vitest";
import { PolicyTool, type PolicyStoreLike } from "@src/agent/tools/policy-tool.js";
import type { DecisionRecord, AppendDecisionResult } from "@src/decision/types.js";

function make_record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 1,
    scope: "global",
    canonical_key: "coding.style",
    value: "use snake_case",
    status: "active",
    priority: 100,
    source: "system",
    rationale: null,
    superseded_by: null,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function make_store(overrides: Partial<PolicyStoreLike> = {}): PolicyStoreLike {
  return {
    list: vi.fn(async () => [make_record()]),
    append: vi.fn(async (input): Promise<AppendDecisionResult> => ({
      action: "created",
      record: make_record({ canonical_key: input.key, value: input.value, scope: input.scope }),
    })),
    get_effective: vi.fn(async () => [make_record()]),
    ...overrides,
  };
}

function make_tool(store?: Partial<PolicyStoreLike>) {
  return new PolicyTool(make_store(store), {
    tool_name: "test_policy",
    category: "decision",
    description: "Test policy tool",
    default_source: "system",
    labels: {
      item: "결정",
      empty_list: "(활성 결정사항 없음)",
      empty_effective: "(유효 결정사항 없음)",
    },
  });
}

describe("PolicyTool", () => {
  describe("action=list", () => {
    it("lists active records", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "list" });
      expect(result).toContain("[P100]");
      expect(result).toContain("coding.style");
      expect(result).toContain("use snake_case");
    });

    it("returns empty message when no records", async () => {
      const tool = make_tool({ list: vi.fn(async () => []) });
      const result = await tool.execute({ action: "list" });
      expect(result).toBe("(활성 결정사항 없음)");
    });

    it("passes filter params to store", async () => {
      const list = vi.fn(async () => []);
      const tool = make_tool({ list });
      await tool.execute({ action: "list", key: "coding", search: "style", limit: 5 });
      expect(list).toHaveBeenCalledWith({
        status: "active",
        key: "coding",
        search: "style",
        limit: 5,
      });
    });

    it("clamps limit to 1-100", async () => {
      const list = vi.fn(async () => []);
      const tool = make_tool({ list });
      await tool.execute({ action: "list", limit: 999 });
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
  });

  describe("action=set", () => {
    it("appends a new record", async () => {
      const append = vi.fn(async (input: any): Promise<AppendDecisionResult> => ({
        action: "created",
        record: make_record({ canonical_key: input.key, value: input.value }),
      }));
      const tool = make_tool({ append });
      const result = await tool.execute({ action: "set", key: "deploy.branch", value: "main" });
      expect(result).toContain("결정 created");
      expect(result).toContain("deploy.branch");
      expect(append).toHaveBeenCalledWith(expect.objectContaining({
        key: "deploy.branch",
        value: "main",
        scope: "global",
        source: "system",
      }));
    });

    it("supports scope parameter", async () => {
      const append = vi.fn(async (input: any): Promise<AppendDecisionResult> => ({
        action: "created",
        record: make_record({ scope: input.scope }),
      }));
      const tool = make_tool({ append });
      await tool.execute({ action: "set", key: "k", value: "v", scope: "team" });
      expect(append).toHaveBeenCalledWith(expect.objectContaining({ scope: "team" }));
    });

    it("requires key and value", async () => {
      const tool = make_tool();
      expect(await tool.execute({ action: "set" })).toContain("Error");
      expect(await tool.execute({ action: "set", key: "k" })).toContain("Error");
      expect(await tool.execute({ action: "set", value: "v" })).toContain("Error");
    });
  });

  describe("action=get_effective", () => {
    it("returns effective records", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "get_effective" });
      expect(result).toContain("[P100:global]");
      expect(result).toContain("coding.style");
    });

    it("returns empty message when none effective", async () => {
      const tool = make_tool({ get_effective: vi.fn(async () => []) });
      const result = await tool.execute({ action: "get_effective" });
      expect(result).toBe("(유효 결정사항 없음)");
    });
  });

  describe("unknown action", () => {
    it("returns error", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "unknown" });
      expect(result).toContain("Error");
      expect(result).toContain("unknown");
    });
  });

  describe("tool interface", () => {
    it("has configured metadata", () => {
      const tool = make_tool();
      expect(tool.name).toBe("test_policy");
      expect(tool.category).toBe("decision");
    });
  });
});
