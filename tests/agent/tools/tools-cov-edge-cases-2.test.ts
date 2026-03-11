/**
 * 여러 도구의 미커버 분기 보충 (edge-cases-2):
 *
 * - ical.ts L61:         default case — unsupported action
 * - validator.ts L171:   json_type(null) → "null" 반환
 * - retriever.ts L94:    simple_relevance("", text) → words.length===0 → return 0
 * - command-intent.ts L163: parse_decision_set_pair — regex 매칭 but !value → null
 * - chain.ts L111:       extract_json_path — 최종 obj===null → return ""
 */

import { describe, it, expect } from "vitest";

// ── imports ────────────────────────────────────────────────────────────────

import { IcalTool } from "@src/agent/tools/ical.js";
import { ValidatorTool } from "@src/agent/tools/validator.js";
import { RetrieverTool } from "@src/agent/tools/retriever.js";
import { parse_decision_set_pair } from "@src/channels/command-intent.js";
import { execute_chain } from "@src/agent/tools/chain.js";
import { ToolRegistry } from "@src/agent/tools/registry.js";
import type { ToolLike, JsonSchema, ToolSchema } from "@src/agent/tools/types.js";

// ── ical.ts L61: default case — unsupported action ────────────────────────

describe("IcalTool — L61: default 알 수 없는 action → Error 반환", () => {
  const tool = new IcalTool();

  it("action='nonexistent' → L61 unsupported action 에러", async () => {
    const r = await tool.execute({ action: "nonexistent_action" });
    expect(String(r)).toContain("unsupported action");
    expect(String(r)).toContain("nonexistent_action");
  });
});

// ── validator.ts L171: json_type(null) → "null" ─────────────────────────

describe("ValidatorTool — L171: json_type(null) → 'null' 반환", () => {
  const tool = new ValidatorTool();

  it("input=JSON null + schema.type=string → json_type(null)='null' → 타입 불일치 (L171)", async () => {
    // JSON.parse("null") = null → json_type(null) → L171: if (val === null) return "null"
    const r = JSON.parse(await tool.execute({
      operation: "schema",
      input: "null",
      schema: JSON.stringify({ type: "string" }),
    }));
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain("expected string, got null");
  });

  it("input=JSON null + schema.type=number → L171 'null' type 반환 → 불일치", async () => {
    const r = JSON.parse(await tool.execute({
      operation: "schema",
      input: "null",
      schema: JSON.stringify({ type: "number" }),
    }));
    expect(r.valid).toBe(false);
  });
});

// ── retriever.ts L94: simple_relevance 빈 쿼리 → words.length===0 → return 0 ──

describe("RetrieverTool — L94: empty query → simple_relevance words.length===0 → 0 반환", () => {
  const tool = new RetrieverTool();

  it("query='' + memory data 있음 → 모든 항목 includes('') = true → L94 simple_relevance 호출 → score=0", async () => {
    // query="" → lower="" → str.includes("") always true → simple_relevance("", ...) 호출
    // words = "".split(/\s+/).filter(Boolean) = [] → words.length=0 → L94 return 0
    const data = JSON.stringify({ key1: "value one", key2: "value two" });
    const r = JSON.parse(await tool.execute({ action: "memory", query: "", data }));
    // score=0인 항목들이 반환됨 (빈 쿼리는 모두 score 0으로 매칭)
    expect(r.results.every((item: Record<string, unknown>) => item.score === 0)).toBe(true);
  });
});

// ── command-intent.ts L163: regex 매칭 but !value → null 반환 ───────────

describe("command-intent — L163: parse_decision_set_pair — value 빈 문자열 → null", () => {
  it("'key: ' (value가 공백만) → trim 후 empty → L163 !value → return null", () => {
    // RE_KEY_VALUE: /^([^=:=]{1,120})\s*[:=]\s*(.+)$/
    // "key: " → group1="key", group2=" " → trim → "" → !value=true → L163 return null
    const r = parse_decision_set_pair("key: ");
    expect(r).toBeNull();
  });

  it("'=value' (key가 빈 문자열) → trim 후 empty → L163 !key → return null", () => {
    // "  =value" → group1="  " → trim → "" → !key=true → L163 return null
    // RE_KEY_VALUE requires [^=:=]{1,120} so "=" doesn't match group1
    // Try: " =value" → [^=:=]{1,120} = " " (space) → trim → "" → !key
    const r = parse_decision_set_pair(" =value");
    expect(r).toBeNull();
  });
});

// ── chain.ts L111: extract_json_path 최종 obj===null → return "" ──────────

describe("ChainTool — chain.ts L111: extract_json_path — 최종 값 null → return ''", () => {
  function make_tool(name: string, handler: (params: Record<string, unknown>) => string): ToolLike {
    return {
      name,
      description: `Test: ${name}`,
      parameters: { type: "object" } as JsonSchema,
      execute: async (params: Record<string, unknown>) => handler(params),
      validate_params: () => [],
      to_schema: () => ({
        type: "function",
        function: { name, description: `Test: ${name}`, parameters: { type: "object" } },
      }) as ToolSchema,
    };
  }

  it("step[0] JSON {'a':null}, step[1] references $steps[0].json.a → null → L111 return ''", async () => {
    const registry = new ToolRegistry();

    // Step 0: returns JSON with null value
    registry.register(make_tool("produce_null_json", () => JSON.stringify({ a: null })));
    // Step 1: receives empty string (from L111 return ""), produces it as output
    registry.register(make_tool("pass_through", (p) => String(p.input ?? "")));

    const result = await execute_chain(registry, [
      { tool: "produce_null_json", params: {} },
      // $steps[0].json.a → extract_json_path('{"a":null}', 'a') → obj=null after loop → L111
      { tool: "pass_through", params: { input: "$steps[0].json.a" } },
    ]);

    expect(result.ok).toBe(true);
    // L111 returns "" for null value
    expect(result.final_output).toBe("");
  });

  it("step[0] JSON {'x':{'y':null}}, $steps[0].json.x.y → null → L111 return ''", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("nested_null", () => JSON.stringify({ x: { y: null } })));
    registry.register(make_tool("echo", (p) => `got:[${p.v}]`));

    const result = await execute_chain(registry, [
      { tool: "nested_null", params: {} },
      { tool: "echo", params: { v: "$steps[0].json.x.y" } },
    ]);

    expect(result.ok).toBe(true);
    // L111 returns "" for null value → p.v = "" → output = "got:[]"
    expect(result.final_output).toBe("got:[]");
  });
});
