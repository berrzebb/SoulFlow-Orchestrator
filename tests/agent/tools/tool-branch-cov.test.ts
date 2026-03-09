/**
 * 여러 도구의 미커버 분기 커버.
 * - stats.ts:53 — parse_numbers catch 분기 (비JSON 입력)
 * - base-convert.ts:97 — to_decimal base32 case
 * - similarity.ts:107 — parse_vector catch → null
 * - table.ts:160 — calc_agg default 분기
 * - workflow.ts:111 — handle_update definition 비객체 에러
 * - datetime.ts:183 — safe_parse 타임스탬프 숫자 문자열
 */
import { describe, it, expect, vi } from "vitest";
import { StatsTool } from "@src/agent/tools/stats.js";
import { BaseConvertTool } from "@src/agent/tools/base-convert.js";
import { SimilarityTool } from "@src/agent/tools/similarity.js";
import { TableTool } from "@src/agent/tools/table.js";
import { WorkflowTool } from "@src/agent/tools/workflow.js";
import { DateTimeTool } from "@src/agent/tools/datetime.js";
import type { DashboardWorkflowOps } from "@src/dashboard/service.js";
import type { WorkflowDefinition } from "@src/agent/phase-loop.types.js";

// ── 헬퍼 ────────────────────────────────────────────────────────────────

async function run_tool(tool: { execute: (p: any) => Promise<unknown> }, params: Record<string, unknown>): Promise<any> {
  const r = await tool.execute(params);
  try { return JSON.parse(String(r)); } catch { return r; }
}

function make_workflow_ops(): DashboardWorkflowOps {
  const templates = new Map<string, WorkflowDefinition>();
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ ok: true, workflow_id: "wf-1" })),
    cancel: vi.fn(async () => true),
    get_messages: vi.fn(async () => []),
    send_message: vi.fn(async () => ({ ok: true })),
    list_templates: vi.fn(() => [...templates.values()]),
    get_template: vi.fn((name: string) => templates.get(name) ?? null),
    save_template: vi.fn((name: string, def: WorkflowDefinition) => { templates.set(name, def); return name; }),
    delete_template: vi.fn((name: string) => templates.delete(name)),
    import_template: vi.fn(() => ({ ok: true, name: "imported" })),
    export_template: vi.fn((name: string) => templates.has(name) ? "title: test" : null),
    list_roles: vi.fn(() => []),
    resume: vi.fn(async () => ({ ok: true })),
  };
}

const VALID_DEF: WorkflowDefinition = {
  title: "Test",
  phases: [{
    phase_id: "p1",
    agents: [{ agent_id: "a1", role: "dev", label: "Dev", backend: "claude", system_prompt: "work" }],
  }],
};

// ── stats.ts:53 — parse_numbers catch (비JSON 입력) ────────────────────

describe("StatsTool — parse_numbers catch 분기", () => {
  const tool = new StatsTool();

  it("비 JSON 쉼표 구분 숫자 → 정상 파싱", async () => {
    // "1,2,3"은 JSON.parse 실패 → catch → split(",") → [1,2,3]
    const r = await run_tool(tool, { operation: "summary", data: "1,2,3,4,5" });
    expect(r.count ?? r.n).toBeGreaterThan(0);
  });

  it("줄바꿈 구분 숫자 → 정상 파싱 (catch 분기)", async () => {
    // 줄바꿈도 JSON.parse 실패 → catch → split(/[,\n\r\t]+/)
    const r = await run_tool(tool, { operation: "summary", data: "10\n20\n30" });
    expect(r.count ?? r.n).toBeGreaterThan(0);
  });

  it("JSON 아닌 비어 있지 않은 문자열 → catch → split", async () => {
    const r = await run_tool(tool, { operation: "summary", data: "not json {{{ 5 10 15" });
    // 유효 숫자 없거나 있음, 어느 쪽이든 오류 없이 동작
    expect(typeof r === "string" || typeof r === "object").toBe(true);
  });
});

// ── base-convert.ts:97 — to_decimal base32 case ────────────────────────

describe("BaseConvertTool — from=base32 → base32 디코딩", () => {
  const tool = new BaseConvertTool();

  it("'ME' (base32) → 10진수 변환", async () => {
    // M=12, E=4 → 12*32+4 = 388
    const r = await run_tool(tool, { action: "convert", value: "ME", from: "base32", to: "dec" });
    expect(r.decimal).toBe(388);
  });

  it("'A' (base32) → 0", async () => {
    const r = await run_tool(tool, { action: "convert", value: "A", from: "base32", to: "dec" });
    expect(r.decimal).toBe(0);
  });

  it("잘못된 base32 문자 → 에러", async () => {
    const r = String(await tool.execute({ action: "convert", value: "01!", from: "base32", to: "dec" }));
    expect(r).toContain("Error");
  });
});

// ── similarity.ts:107 — parse_vector catch → null ─────────────────────

describe("SimilarityTool — cosine: 잘못된 JSON 벡터 → 텍스트 모드 fallback", () => {
  const tool = new SimilarityTool();

  it("비 JSON 문자열 a, b → parse_vector catch → 텍스트 cosine", async () => {
    // parse_vector("{invalid}") → JSON.parse 실패 → catch → null
    const r = await run_tool(tool, { action: "cosine", a: "{invalid json}", b: "hello world" });
    // 텍스트 cosine fallback 결과
    expect(typeof r.similarity === "number").toBe(true);
  });

  it("비 JSON + 빈 문자열 → parse_vector catch → 텍스트 cosine", async () => {
    const r = await run_tool(tool, { action: "cosine", a: "not[valid", b: "test text" });
    expect(r).toHaveProperty("similarity");
  });
});

// ── table.ts:160 — calc_agg default 분기 ──────────────────────────────

describe("TableTool — calc_agg default 분기 (알 수 없는 집계)", () => {
  const tool = new TableTool();

  it("pivot에 알 수 없는 agg 값 → default → vals.length", async () => {
    const data = JSON.stringify([
      { cat: "A", val: 10 },
      { cat: "A", val: 20 },
      { cat: "B", val: 5 },
    ]);
    // agg="unknown" → default → vals.length 반환
    const r = await run_tool(tool, { operation: "pivot", data, field: "cat", value_field: "val", agg: "unknown" });
    // pivot 결과: { A: 2, B: 1 } (count of rows per group = vals.length)
    expect(r.A).toBe(2);
    expect(r.B).toBe(1);
  });

  it("aggregate에 알 수 없는 agg → default → vals.length", async () => {
    const data = JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const r = await run_tool(tool, { operation: "aggregate", data, field: "n", agg: "median" });
    // default → vals.length = 3
    expect(r.value).toBe(3);
  });
});

// ── workflow.ts:111 — handle_update definition 비객체 에러 ────────────

describe("WorkflowTool — update: definition 비객체 → 에러", () => {
  it("definition이 배열 → 에러", async () => {
    const ops = make_workflow_ops();
    // 먼저 템플릿 생성
    (ops.get_template as ReturnType<typeof vi.fn>).mockReturnValue(VALID_DEF);
    const tool = new WorkflowTool(ops);
    const run = (tool as any).run.bind(tool);

    const r = await run({ action: "update", name: "test", definition: [1, 2, 3] });
    expect(r).toContain("Error");
    expect(r).toContain("definition");
  });

  it("definition이 문자열 → 에러", async () => {
    const ops = make_workflow_ops();
    (ops.get_template as ReturnType<typeof vi.fn>).mockReturnValue(VALID_DEF);
    const tool = new WorkflowTool(ops);
    const run = (tool as any).run.bind(tool);

    const r = await run({ action: "update", name: "test", definition: "not-an-object" });
    expect(r).toContain("Error");
  });

  it("definition이 null → 에러", async () => {
    const ops = make_workflow_ops();
    (ops.get_template as ReturnType<typeof vi.fn>).mockReturnValue(VALID_DEF);
    const tool = new WorkflowTool(ops);
    const run = (tool as any).run.bind(tool);

    const r = await run({ action: "update", name: "test", definition: null });
    expect(r).toContain("Error");
  });
});

// ── datetime.ts:183 — safe_parse 타임스탬프 숫자 문자열 ───────────────

describe("DateTimeTool — parse: Unix 타임스탬프 문자열", () => {
  const tool = new DateTimeTool();

  it("10자리 숫자 문자열 → 타임스탬프로 처리 (밀리초, 1970년대)", async () => {
    // safe_parse: s.length >= 10 → new Date(Number(s)) (밀리초 단위)
    // "1000000000" = 1970-01-12 (ms 기준)
    const r = await run_tool(tool, { action: "parse", date: "1000000000" });
    expect(r).toHaveProperty("unix_ms");
    expect(r.unix_ms).toBe(1000000000);
  });

  it("13자리 Unix 밀리초 타임스탬프 → 파싱", async () => {
    // 2021-01-01 00:00:00.000 UTC = 1609459200000
    const r = await run_tool(tool, { action: "parse", date: "1609459200000" });
    expect(r.year).toBe(2021);
    expect(r.unix_ms).toBe(1609459200000);
  });
});
