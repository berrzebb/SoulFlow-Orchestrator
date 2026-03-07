import { describe, it, expect } from "vitest";
import { aggregate_handler } from "@src/agent/nodes/aggregate.js";
import { gate_handler } from "@src/agent/nodes/gate.js";
import { assert_handler } from "@src/agent/nodes/assert.js";
import { regex_handler } from "@src/agent/nodes/regex.js";
import { encoding_handler } from "@src/agent/nodes/encoding.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type {
  AggregateNodeDefinition,
  GateNodeDefinition,
  AssertNodeDefinition,
  RegexNodeDefinition,
  EncodingNodeDefinition,
} from "@src/agent/workflow-node.types.js";

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, abort_signal: undefined, workspace: undefined };
}

function agg_node(overrides: Partial<AggregateNodeDefinition> = {}): AggregateNodeDefinition {
  return {
    node_id: "agg1", title: "Agg", node_type: "aggregate",
    operation: "collect", array_field: "items",
    ...overrides,
  } as AggregateNodeDefinition;
}

// ── Aggregate Handler ──

describe("aggregate_handler", () => {
  it("collect — 배열 그대로 반환", async () => {
    const ctx = make_ctx({ items: [1, 2, 3] });
    const { output } = await aggregate_handler.execute(agg_node(), ctx);
    expect(output).toEqual({ result: [1, 2, 3], count: 3 });
  });

  it("count — 배열 길이 반환", async () => {
    const ctx = make_ctx({ items: ["a", "b"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "count" }), ctx);
    expect(output).toEqual({ result: 2, count: 2 });
  });

  it("sum — 합계 계산", async () => {
    const ctx = make_ctx({ items: [10, 20, 30] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "sum" }), ctx);
    expect(output).toEqual({ result: 60, count: 3 });
  });

  it("avg — 평균 계산", async () => {
    const ctx = make_ctx({ items: [10, 20, 30] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "avg" }), ctx);
    expect(output).toEqual({ result: 20, count: 3 });
  });

  it("avg — 빈 배열 시 0 반환", async () => {
    const ctx = make_ctx({ items: [] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "avg" }), ctx);
    expect(output).toEqual({ result: 0, count: 0 });
  });

  it("min — 최솟값", async () => {
    const ctx = make_ctx({ items: [5, 2, 8] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "min" }), ctx);
    expect(output).toEqual({ result: 2, count: 3 });
  });

  it("max — 최댓값", async () => {
    const ctx = make_ctx({ items: [5, 2, 8] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "max" }), ctx);
    expect(output).toEqual({ result: 8, count: 3 });
  });

  it("min — 비숫자만 있으면 null 반환 (Infinity 버그 수정)", async () => {
    const ctx = make_ctx({ items: ["abc", "def"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "min" }), ctx);
    expect(output).toEqual({ result: null, count: 2 });
  });

  it("max — 비숫자만 있으면 null 반환 (-Infinity 버그 수정)", async () => {
    const ctx = make_ctx({ items: ["abc", "def"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "max" }), ctx);
    expect(output).toEqual({ result: null, count: 2 });
  });

  it("join — 구분자로 결합", async () => {
    const ctx = make_ctx({ items: ["a", "b", "c"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "join", separator: ", " }), ctx);
    expect(output).toEqual({ result: "a, b, c", count: 3 });
  });

  it("join — 기본 구분자는 개행", async () => {
    const ctx = make_ctx({ items: ["x", "y"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "join" }), ctx);
    expect(output).toEqual({ result: "x\ny", count: 2 });
  });

  it("unique — 중복 제거", async () => {
    const ctx = make_ctx({ items: ["a", "b", "a", "c", "b"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "unique" }), ctx);
    expect(output).toEqual({ result: ["a", "b", "c"], count: 5 });
  });

  it("flatten — 중첩 배열 평탄화", async () => {
    const ctx = make_ctx({ items: [[1, 2], [3, 4]] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "flatten" }), ctx);
    expect(output).toEqual({ result: [1, 2, 3, 4], count: 2 });
  });

  it("중첩 경로 접근 (dot notation)", async () => {
    const ctx = make_ctx({ data: { nested: { nums: [100, 200] } } });
    const { output } = await aggregate_handler.execute(
      agg_node({ operation: "sum", array_field: "data.nested.nums" }), ctx,
    );
    expect(output).toEqual({ result: 300, count: 2 });
  });

  it("배열 인덱스 접근 (bracket notation)", async () => {
    const ctx = make_ctx({ lists: [[10, 20, 30], [40, 50]] });
    const { output } = await aggregate_handler.execute(
      agg_node({ operation: "sum", array_field: "lists[0]" }), ctx,
    );
    expect(output).toEqual({ result: 60, count: 3 });
  });

  it("존재하지 않는 필드 → 빈 배열", async () => {
    const ctx = make_ctx({});
    const { output } = await aggregate_handler.execute(agg_node({ array_field: "missing" }), ctx);
    expect(output).toEqual({ result: [], count: 0 });
  });

  it("test — array_field 비어 있으면 경고", () => {
    const result = aggregate_handler.test(agg_node({ array_field: "" }));
    expect(result.warnings).toContain("array_field is required");
  });
});

// ── Gate Handler ──

describe("gate_handler", () => {
  function gate_node(overrides: Partial<GateNodeDefinition> = {}): GateNodeDefinition {
    return {
      node_id: "gate1", title: "Gate", node_type: "gate",
      quorum: 2, depends_on: ["step_a", "step_b", "step_c"],
      ...overrides,
    } as GateNodeDefinition;
  }

  it("quorum 충족 시 quorum_met=true", async () => {
    const ctx = make_ctx({ step_a: "done", step_b: "done" });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(true);
    expect(output.completed).toEqual(["step_a", "step_b"]);
    expect(output.pending).toEqual(["step_c"]);
  });

  it("quorum 미충족 시 quorum_met=false", async () => {
    const ctx = make_ctx({ step_a: "done" });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(false);
    expect(output.completed).toEqual(["step_a"]);
    expect(output.pending).toEqual(["step_b", "step_c"]);
  });

  it("모든 소스 완료", async () => {
    const ctx = make_ctx({ step_a: 1, step_b: 2, step_c: 3 });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(true);
    expect(output.completed).toHaveLength(3);
    expect(output.pending).toHaveLength(0);
    expect(output.results).toEqual({ step_a: 1, step_b: 2, step_c: 3 });
  });

  it("quorum=1 이면 하나만 완료돼도 통과", async () => {
    const ctx = make_ctx({ step_c: "ok" });
    const { output } = await gate_handler.execute(gate_node({ quorum: 1 }), ctx);
    expect(output.quorum_met).toBe(true);
  });

  it("depends_on 없으면 빈 결과", async () => {
    const { output } = await gate_handler.execute(
      gate_node({ depends_on: [] }), make_ctx(),
    );
    expect(output.completed).toEqual([]);
    expect(output.quorum_met).toBe(false); // 0 completed < quorum 1
  });

  it("test — depends_on 비어 있으면 경고", () => {
    const result = gate_handler.test(gate_node({ depends_on: [] }));
    expect(result.warnings).toContain("depends_on is empty — gate needs source nodes");
  });

  it("test — quorum이 소스 수 초과하면 경고", () => {
    const result = gate_handler.test(gate_node({ quorum: 5 }));
    expect(result.warnings.some((w) => w.includes("quorum exceeds"))).toBe(true);
  });
});

// ── Assert Handler ──

describe("assert_handler", () => {
  function assert_node(overrides: Partial<AssertNodeDefinition> = {}): AssertNodeDefinition {
    return {
      node_id: "assert1", title: "Assert", node_type: "assert",
      assertions: [], on_fail: "continue",
      ...overrides,
    } as AssertNodeDefinition;
  }

  it("모든 조건 통과 시 valid=true", async () => {
    const ctx = make_ctx({ x: 10 });
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 5" }, { condition: "memory.x < 20" }],
    }), ctx);
    expect(output.valid).toBe(true);
    expect(output.errors).toEqual([]);
    expect(output.checked).toBe(2);
  });

  it("조건 실패 시 valid=false + 에러 메시지", async () => {
    const ctx = make_ctx({ x: 3 });
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 5", message: "x must be > 5" }],
    }), ctx);
    expect(output.valid).toBe(false);
    expect(output.errors).toContain("x must be > 5");
  });

  it("on_fail=halt이면 에러 throw", async () => {
    const ctx = make_ctx({ x: 0 });
    await expect(assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 0" }],
      on_fail: "halt",
    }), ctx)).rejects.toThrow("Assert failed");
  });

  it("잘못된 표현식은 에러 메시지에 포함", async () => {
    const ctx = make_ctx({});
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "invalid syntax @@" }],
    }), ctx);
    expect(output.valid).toBe(false);
    expect(output.errors[0]).toContain("Expression error");
  });

  it("빈 assertions → valid=true, checked=0", async () => {
    const { output } = await assert_handler.execute(assert_node(), make_ctx());
    expect(output.valid).toBe(true);
    expect(output.checked).toBe(0);
  });

  it("test — assertions 비어 있으면 경고", () => {
    const result = assert_handler.test(assert_node());
    expect(result.warnings).toContain("at least one assertion is required");
  });
});

// ── Regex Handler ──

describe("regex_handler", () => {
  function regex_node(overrides: Partial<RegexNodeDefinition> = {}): RegexNodeDefinition {
    return {
      node_id: "regex1", title: "Regex", node_type: "regex",
      operation: "match", input: "", pattern: "", flags: "", replacement: "",
      ...overrides,
    } as RegexNodeDefinition;
  }

  it("test 연산 — 매칭 여부 확인", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello world", pattern: "world",
    }), make_ctx());
    expect(output.success).toBe(true);
    expect(JSON.parse(output.result as string).matches).toBe(true);
  });

  it("test 연산 — 불일치", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "world",
    }), make_ctx());
    expect(JSON.parse(output.result as string).matches).toBe(false);
  });

  it("match 연산 — 첫 번째 매칭", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "abc 123 def", pattern: "\\d+",
    }), make_ctx());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(true);
    expect(parsed.match).toBe("123");
  });

  it("match 연산 — 매칭 없음", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "abc def", pattern: "\\d+",
    }), make_ctx());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(false);
  });

  it("match_all 연산 — 모든 매칭", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match_all", input: "a1 b2 c3", pattern: "\\d", flags: "g",
    }), make_ctx());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.count).toBe(3);
    expect(parsed.matches.map((m: { match: string }) => m.match)).toEqual(["1", "2", "3"]);
  });

  it("replace 연산 — 치환", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "replace", input: "hello world", pattern: "world", replacement: "earth",
    }), make_ctx());
    expect(output.result).toBe("hello earth");
  });

  it("replace 연산 — 글로벌 치환", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "replace", input: "aa bb aa", pattern: "aa", flags: "g", replacement: "cc",
    }), make_ctx());
    expect(output.result).toBe("cc bb cc");
  });

  it("split 연산 — 분할", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "split", input: "a,b,,c", pattern: ",",
    }), make_ctx());
    expect(JSON.parse(output.result as string)).toEqual(["a", "b", "", "c"]);
  });

  it("extract 연산 — 그룹 추출", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "extract", input: "name: Alice, age: 30", pattern: "(\\w+): (\\w+)", flags: "g",
    }), make_ctx());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.count).toBe(2);
    expect(parsed.extracted[0]).toEqual({ group_1: "name", group_2: "Alice" });
  });

  it("빈 pattern → 에러", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "",
    }), make_ctx());
    expect(output.success).toBe(false);
  });

  it("잘못된 regex → success=false", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "[invalid",
    }), make_ctx());
    expect(output.success).toBe(false);
  });

  it("지원하지 않는 연산 → success=false", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "unknown_op", input: "hello", pattern: "h",
    }), make_ctx());
    expect(output.success).toBe(false);
  });

  it("test() — pattern 비어 있으면 경고", () => {
    const result = regex_handler.test(regex_node({ pattern: "" }));
    expect(result.warnings).toContain("pattern is required");
  });

  it("test() — 잘못된 regex면 경고", () => {
    const result = regex_handler.test(regex_node({ pattern: "[bad" }));
    expect(result.warnings).toContain("invalid regex pattern");
  });

  it("템플릿 변수 resolve (memory 접두사 필요)", async () => {
    const ctx = make_ctx({ text: "hello 42 world", pat: "\\d+" });
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "{{memory.text}}", pattern: "{{memory.pat}}",
    }), ctx);
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(true);
    expect(parsed.match).toBe("42");
  });
});

// ── Encoding Handler ──

describe("encoding_handler", () => {
  function enc_node(overrides: Partial<EncodingNodeDefinition> = {}): EncodingNodeDefinition {
    return {
      node_id: "enc1", title: "Encoding", node_type: "encoding",
      operation: "encode", input: "", format: "base64", count: 1,
      ...overrides,
    } as EncodingNodeDefinition;
  }

  it("base64 encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "hello", format: "base64",
    }), make_ctx());
    expect(output.result).toBe(Buffer.from("hello").toString("base64"));
    expect(output.success).toBe(true);
  });

  it("base64 decode", async () => {
    const encoded = Buffer.from("hello").toString("base64");
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: encoded, format: "base64",
    }), make_ctx());
    expect(output.result).toBe("hello");
  });

  it("hex encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "AB", format: "hex",
    }), make_ctx());
    expect(output.result).toBe(Buffer.from("AB").toString("hex"));
  });

  it("hex decode", async () => {
    const hex = Buffer.from("AB").toString("hex");
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: hex, format: "hex",
    }), make_ctx());
    expect(output.result).toBe("AB");
  });

  it("url encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "hello world", format: "url",
    }), make_ctx());
    expect(output.result).toBe("hello%20world");
  });

  it("url decode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: "hello%20world", format: "url",
    }), make_ctx());
    expect(output.result).toBe("hello world");
  });

  it("sha256 hash", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "hash", input: "test", format: "sha256",
    }), make_ctx());
    expect(output.success).toBe(true);
    expect((output.result as string).length).toBe(64); // SHA-256 hex = 64 chars
  });

  it("md5 hash", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "hash", input: "test", format: "md5",
    }), make_ctx());
    expect(output.success).toBe(true);
    expect((output.result as string).length).toBe(32); // MD5 hex = 32 chars
  });

  it("uuid — 단일 생성", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "uuid",
    }), make_ctx());
    expect(output.success).toBe(true);
    expect(output.result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  it("uuid — 복수 생성", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "uuid", count: 3,
    }), make_ctx());
    const uuids = (output.result as string).split("\n");
    expect(uuids).toHaveLength(3);
    for (const u of uuids) expect(u).toMatch(/^[0-9a-f]{8}-/);
  });

  it("지원하지 않는 format → 에러 문자열", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "x", format: "rot13",
    }), make_ctx());
    expect(output.result).toContain("Unsupported");
  });

  it("지원하지 않는 operation → Unsupported", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "compress", input: "x",
    }), make_ctx());
    expect(output.result).toContain("Unsupported");
  });

  it("test() — uuid가 아닌데 input 없으면 경고", () => {
    const result = encoding_handler.test(enc_node({ operation: "encode", input: "" }));
    expect(result.warnings).toContain("input is required");
  });

  it("test() — uuid면 input 없어도 경고 없음", () => {
    const result = encoding_handler.test(enc_node({ operation: "uuid", input: "" }));
    expect(result.warnings).toHaveLength(0);
  });

  it("템플릿 변수 resolve (memory 접두사 필요)", async () => {
    const ctx = make_ctx({ msg: "hello" });
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "{{memory.msg}}", format: "base64",
    }), ctx);
    expect(output.result).toBe(Buffer.from("hello").toString("base64"));
  });
});
