/**
 * text_splitter_handler — 구분자 기반 분할, test() 경고, 중첩 필드 접근 실패 케이스 커버.
 */
import { describe, it, expect } from "vitest";
import { text_splitter_handler } from "../../../src/agent/nodes/text-splitter.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

function make_node(overrides: Record<string, unknown>): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "text_splitter",
    input_field: "text",
    chunk_size: 1000,
    chunk_overlap: 200,
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

// ══════════════════════════════════════════
// split_text 내부 로직 — 구분자 기반 분할 (chunk 오버플로)
// ══════════════════════════════════════════

describe("text_splitter_handler — 구분자 기반 분할 (separator path)", () => {
  it("separator + chunk 오버플로 → 새 청크 시작 + overlap 포함", async () => {
    // chunk_size=15, overlap=3, separator="\n\n"
    // parts: "Hello World"(11), "Goodbye World"(13), "Another"(7)
    // current="Hello World"(11) → 11+13+2=26>15 → push, tail="rld", current="rld\n\nGoodbye World"
    const node = make_node({ input_field: "content", chunk_size: 15, chunk_overlap: 3, separator: "\n\n" });
    const ctx = make_ctx({ content: "Hello World\n\nGoodbye World\n\nAnother" });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBeGreaterThan(1);
    expect(Array.isArray(r.output.chunks)).toBe(true);
  });

  it("구분자가 있지만 전체 텍스트가 chunk_size 이하 → 1 청크", async () => {
    const node = make_node({ input_field: "t", chunk_size: 1000, chunk_overlap: 0, separator: "\n" });
    const ctx = make_ctx({ t: "line1\nline2\nline3" });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBe(1);
  });

  it("구분자 없는 고정 분할 — overlap 적용", async () => {
    const node = make_node({ input_field: "t", chunk_size: 5, chunk_overlap: 2, separator: undefined });
    // "0123456789" → chunks: "01234", "34567"(step=3), "6789"
    const ctx = make_ctx({ t: "0123456789" });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBeGreaterThan(1);
    expect(String(r.output.chunks[0])).toBe("01234");
  });

  it("빈 문자열 → chunk_count=0", async () => {
    const node = make_node({ input_field: "t", chunk_size: 100, chunk_overlap: 0 });
    const ctx = make_ctx({ t: "" });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBe(0);
  });
});

// ══════════════════════════════════════════
// 중첩 필드 접근
// ══════════════════════════════════════════

describe("text_splitter_handler — 중첩 필드 접근", () => {
  it("중첩 필드 (a.b) 성공", async () => {
    const node = make_node({ input_field: "doc.body", chunk_size: 100, chunk_overlap: 0 });
    const ctx = make_ctx({ doc: { body: "Some text content here" } });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBeGreaterThan(0);
  });

  it("중첩 필드 없음 → chunk_count=0", async () => {
    const node = make_node({ input_field: "doc.missing_field", chunk_size: 100, chunk_overlap: 0 });
    const ctx = make_ctx({ doc: { other: "value" } });
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBe(0);
    expect(r.output.chunks).toEqual([]);
  });

  it("필드가 문자열이 아님 → chunk_count=0", async () => {
    const node = make_node({ input_field: "count", chunk_size: 100, chunk_overlap: 0 });
    const ctx = make_ctx({ count: 42 }); // number, not string
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBe(0);
  });

  it("memory에 필드 없음 → chunk_count=0", async () => {
    const node = make_node({ input_field: "nonexistent", chunk_size: 100, chunk_overlap: 0 });
    const ctx = make_ctx({});
    const r = await text_splitter_handler.execute(node, ctx);
    expect(r.output.chunk_count).toBe(0);
  });
});

// ══════════════════════════════════════════
// test() 경고 케이스
// ══════════════════════════════════════════

describe("text_splitter_handler — test() 경고", () => {
  it("input_field 없음 → warnings 포함", () => {
    const node = make_node({ input_field: "", chunk_size: 1000, chunk_overlap: 200 });
    const r = text_splitter_handler.test(node);
    expect(r.warnings.some(w => w.includes("input_field"))).toBe(true);
  });

  it("chunk_size < 100 → 경고", () => {
    const node = make_node({ input_field: "t", chunk_size: 50, chunk_overlap: 10 });
    const r = text_splitter_handler.test(node);
    expect(r.warnings.some(w => w.includes("chunk_size"))).toBe(true);
  });

  it("chunk_overlap >= chunk_size → 경고", () => {
    const node = make_node({ input_field: "t", chunk_size: 100, chunk_overlap: 100 });
    const r = text_splitter_handler.test(node);
    expect(r.warnings.some(w => w.includes("chunk_overlap"))).toBe(true);
  });

  it("정상 설정 → warnings 없음", () => {
    const node = make_node({ input_field: "t", chunk_size: 500, chunk_overlap: 50 });
    const r = text_splitter_handler.test(node);
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 separator '(none)' 표시 (separator 없음)", () => {
    const node = make_node({ input_field: "t", chunk_size: 500, chunk_overlap: 50, separator: undefined });
    const r = text_splitter_handler.test(node);
    expect(r.preview.separator).toBe("(none)");
  });

  it("preview에 separator 값 표시", () => {
    const node = make_node({ input_field: "t", chunk_size: 500, chunk_overlap: 50, separator: "\n\n" });
    const r = text_splitter_handler.test(node);
    expect(r.preview.separator).toBe("\n\n");
  });
});

// ══════════════════════════════════════════
// create_default
// ══════════════════════════════════════════

describe("text_splitter_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = text_splitter_handler.create_default!();
    expect(d.chunk_size).toBe(1000);
    expect(d.chunk_overlap).toBe(200);
    expect(d.separator).toBe("\n\n");
  });
});

describe("text_splitter_handler — non-object 경로 (L65)", () => {
  it("중첩 필드 탐색 중 중간 값이 non-object → else { text=undefined; break } (L65)", async () => {
    // input_field="a.b.c", memory.a = "string" (non-object) → 두 번째 루프에서 else 분기
    const node = make_node({ input_field: "a.b.c" });
    const ctx = make_ctx({ a: "string_not_object" });
    const r = await text_splitter_handler.execute(node, ctx);
    // text=undefined → { chunks: [], chunk_count: 0 }
    const out = r.output as { chunks: unknown[]; chunk_count: number };
    expect(out.chunks).toEqual([]);
    expect(out.chunk_count).toBe(0);
  });
});
