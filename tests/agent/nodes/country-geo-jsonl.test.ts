/**
 * country / geo / jsonl 노드 핸들러 — 기본 커버리지.
 * 각 핸들러의 metadata / create_default / execute / test 분기 커버.
 */
import { describe, it, expect } from "vitest";
import { country_handler } from "@src/agent/nodes/country.js";
import { geo_handler } from "@src/agent/nodes/geo.js";
import { jsonl_handler } from "@src/agent/nodes/jsonl.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// country_handler
// ══════════════════════════════════════════

describe("country_handler", () => {
  it("metadata: node_type = country", () => expect(country_handler.node_type).toBe("country"));

  it("create_default: action=lookup", () => {
    const d = country_handler.create_default?.();
    expect((d as any).action).toBe("lookup");
  });

  it("execute: lookup KR → 한국 정보 반환", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "lookup", code: "KR" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: search 'Korea' → 검색 결과", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "search", query: "Korea" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: list → 전체 국가 목록", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "list" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: by_dial_code +82 → 한국", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "by_dial_code", dial_code: "+82" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: by_currency KRW", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "by_currency", currency: "KRW" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: by_continent AS", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "by_continent", continent: "AS" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: lookup + code 없음 → 경고", () => {
    const r = country_handler.test({ node_id: "n1", node_type: "country", action: "lookup", code: "" } as any);
    expect(r.warnings).toContain("code is required for lookup");
  });

  it("test: search + query 없음 → 경고", () => {
    const r = country_handler.test({ node_id: "n1", node_type: "country", action: "search", query: "" } as any);
    expect(r.warnings).toContain("query is required for search");
  });
});

// ══════════════════════════════════════════
// geo_handler
// ══════════════════════════════════════════

describe("geo_handler", () => {
  it("metadata: node_type = geo", () => expect(geo_handler.node_type).toBe("geo"));

  it("create_default: action=distance", () => {
    const d = geo_handler.create_default?.();
    expect((d as any).action).toBe("distance");
  });

  it("execute: distance Seoul→Busan", async () => {
    const r = await geo_handler.execute({
      node_id: "n1", node_type: "geo", action: "distance",
      lat1: 37.5665, lon1: 126.9780, lat2: 35.1796, lon2: 129.0756,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: bearing", async () => {
    const r = await geo_handler.execute({
      node_id: "n1", node_type: "geo", action: "bearing",
      lat1: 37.5, lon1: 127.0, lat2: 35.1, lon2: 129.0,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: geohash_encode", async () => {
    const r = await geo_handler.execute({
      node_id: "n1", node_type: "geo", action: "geohash_encode",
      lat1: 37.5665, lon1: 126.9780, precision: 7,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: geohash_decode", async () => {
    const r = await geo_handler.execute({
      node_id: "n1", node_type: "geo", action: "geohash_decode",
      geohash: "wydm9",
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: dms_to_decimal", async () => {
    const r = await geo_handler.execute({
      node_id: "n1", node_type: "geo", action: "dms_to_decimal",
      dms: "37°33'59\"N 126°58'41\"E",
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: distance + lat1 없음 → 경고", () => {
    const r = geo_handler.test({ node_id: "n1", node_type: "geo", action: "distance" } as any);
    expect(r.warnings).toContain("lat1/lon1 are required");
    expect(r.warnings).toContain("lat2/lon2 are required");
  });

  it("test: geohash_encode + lat1 없음 → 경고 (lat2/lon2는 불필요)", () => {
    const r = geo_handler.test({ node_id: "n1", node_type: "geo", action: "geohash_encode" } as any);
    expect(r.warnings).toContain("lat1/lon1 are required");
    // lat2/lon2 경고 없음
    expect(r.warnings.some(w => w.includes("lat2"))).toBe(false);
  });
});

// ══════════════════════════════════════════
// jsonl_handler
// ══════════════════════════════════════════

describe("jsonl_handler", () => {
  it("metadata: node_type = jsonl", () => expect(jsonl_handler.node_type).toBe("jsonl"));

  it("create_default: action=parse", () => {
    const d = jsonl_handler.create_default?.();
    expect((d as any).action).toBe("parse");
  });

  it("execute: parse JSONL → records", async () => {
    const r = await jsonl_handler.execute({
      node_id: "n1", node_type: "jsonl", action: "parse",
      input: '{"a":1}\n{"a":2}',
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: generate from JSON array → JSONL", async () => {
    const r = await jsonl_handler.execute({
      node_id: "n1", node_type: "jsonl", action: "generate",
      data: '[{"a":1},{"a":2}]',
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: filter by field/value", async () => {
    const r = await jsonl_handler.execute({
      node_id: "n1", node_type: "jsonl", action: "filter",
      input: '{"x":1}\n{"x":2}', field: "x", value: "1",
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: head N records", async () => {
    const r = await jsonl_handler.execute({
      node_id: "n1", node_type: "jsonl", action: "head",
      input: '{"a":1}\n{"a":2}\n{"a":3}', count: 2,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: parse + input 없음 → 경고", () => {
    const r = jsonl_handler.test({ node_id: "n1", node_type: "jsonl", action: "parse", input: "" } as any);
    expect(r.warnings).toContain("input is required");
  });

  it("test: generate + data 없음 → 경고", () => {
    const r = jsonl_handler.test({ node_id: "n1", node_type: "jsonl", action: "generate", data: "" } as any);
    expect(r.warnings).toContain("data (JSON array) is required for generate");
  });
});
