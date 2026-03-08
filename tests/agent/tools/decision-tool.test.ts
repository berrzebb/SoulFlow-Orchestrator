/**
 * DecisionTool — DecisionService → PolicyTool 어댑터 검증.
 * PolicyTool 로직은 policy-tool.test.ts에서 검증됨.
 * 여기서는 DecisionService 메서드가 올바르게 위임되는지 확인.
 */
import { describe, it, expect, vi } from "vitest";
import { DecisionTool } from "../../../src/agent/tools/decision-tool.js";
import type { DecisionService } from "../../../src/decision/index.js";
import type { DecisionRecord, AppendDecisionResult } from "../../../src/decision/types.js";

function make_record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 1,
    scope: "global",
    canonical_key: "test.key",
    value: "test_value",
    status: "active",
    priority: 100,
    source: "system",
    rationale: null,
    superseded_by: null,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function make_decision_svc(overrides: Partial<DecisionService> = {}): DecisionService {
  return {
    list_decisions: vi.fn().mockResolvedValue([make_record()]),
    append_decision: vi.fn().mockResolvedValue({
      action: "created",
      record: make_record({ canonical_key: "my.key", value: "my_value" }),
    } as AppendDecisionResult),
    get_effective_decisions: vi.fn().mockResolvedValue([make_record()]),
    ...overrides,
  } as unknown as DecisionService;
}

describe("DecisionTool — list (DecisionService.list_decisions 위임)", () => {
  it("목록 반환", async () => {
    const svc = make_decision_svc();
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "list" });
    expect(vi.mocked(svc.list_decisions)).toHaveBeenCalled();
    expect(result).toContain("test.key");
    expect(result).toContain("test_value");
  });

  it("결과 없음 → 안내 메시지", async () => {
    const svc = make_decision_svc({ list_decisions: vi.fn().mockResolvedValue([]) });
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "list" });
    expect(result).toContain("없음");
  });
});

describe("DecisionTool — set (DecisionService.append_decision 위임)", () => {
  it("결정사항 저장 → append_decision 호출됨", async () => {
    const svc = make_decision_svc();
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "set", key: "coding.style", value: "snake_case" });
    expect(vi.mocked(svc.append_decision)).toHaveBeenCalledWith(
      expect.objectContaining({ key: "coding.style", value: "snake_case", source: "system" }),
    );
    // PolicyTool format: "${item} ${action}: [${scope}] ${input.key} = ${record.value}"
    expect(result).toContain("coding.style");
    expect(result).toContain("my_value");
  });

  it("key 없음 → Error 반환", async () => {
    const svc = make_decision_svc();
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "set", value: "val" });
    expect(result).toContain("Error");
    expect(vi.mocked(svc.append_decision)).not.toHaveBeenCalled();
  });

  it("value 없음 → Error 반환", async () => {
    const svc = make_decision_svc();
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "set", key: "k" });
    expect(result).toContain("Error");
  });
});

describe("DecisionTool — get_effective (DecisionService.get_effective_decisions 위임)", () => {
  it("유효 결정사항 반환", async () => {
    const svc = make_decision_svc();
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "get_effective" });
    expect(vi.mocked(svc.get_effective_decisions)).toHaveBeenCalled();
    expect(result).toContain("test.key");
  });

  it("결과 없음 → 안내 메시지", async () => {
    const svc = make_decision_svc({ get_effective_decisions: vi.fn().mockResolvedValue([]) });
    const tool = new DecisionTool(svc);
    const result = await tool.execute({ action: "get_effective" });
    expect(result).toContain("없음");
  });
});

describe("DecisionTool — 메타데이터", () => {
  it("tool name = 'decision'", () => {
    const tool = new DecisionTool(make_decision_svc());
    expect(tool.name).toBe("decision");
  });

  it("category = 'decision'", () => {
    const tool = new DecisionTool(make_decision_svc());
    expect(tool.category).toBe("decision");
  });

  it("알 수 없는 action → Error", async () => {
    const tool = new DecisionTool(make_decision_svc());
    const result = await tool.execute({ action: "unknown" });
    expect(result).toContain("Error");
  });
});
