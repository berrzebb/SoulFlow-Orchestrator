/**
 * yaml / math / hash / text / stats 노드 핸들러 — 미커버 분기 보충.
 * 각 핸들러의 create_default + 특수 분기(toml/ini/dotenv/currency/crc32/filename_safe/timeseries) 커버.
 */
import { describe, it, expect } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";
import { yaml_handler } from "@src/agent/nodes/yaml.js";
import { math_handler } from "@src/agent/nodes/math.js";
import { hash_handler } from "@src/agent/nodes/hash.js";
import { text_handler } from "@src/agent/nodes/text.js";
import { stats_handler } from "@src/agent/nodes/stats.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// yaml_handler
// ══════════════════════════════════════════

describe("yaml_handler — 미커버 분기", () => {
  it("create_default: action=parse (L21)", () => {
    const d = yaml_handler.create_default?.();
    expect((d as any).action).toBe("parse");
  });

  it("execute: format=toml → TomlTool 위임 (L33-35)", async () => {
    const r = await yaml_handler.execute({ node_id: "n1", node_type: "yaml", action: "parse", format: "toml", data: "[section]\nkey=\"value\"" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: format=ini → IniTool 위임 (L37-39)", async () => {
    const r = await yaml_handler.execute({ node_id: "n1", node_type: "yaml", action: "parse", format: "ini", data: "[section]\nkey=value" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: format=dotenv → DotenvTool 위임 (L41-43)", async () => {
    const r = await yaml_handler.execute({ node_id: "n1", node_type: "yaml", action: "parse", format: "dotenv", data: "KEY=value\nOTHER=123" } as any, ctx);
    expect(r.output).toBeDefined();
  });
});

// ══════════════════════════════════════════
// math_handler
// ══════════════════════════════════════════

describe("math_handler — 미커버 분기", () => {
  it("create_default: operation=eval (L22)", () => {
    const d = math_handler.create_default?.();
    expect((d as any).operation).toBe("eval");
  });

  it("execute: operation=currency → CurrencyTool 위임 (L28-35)", async () => {
    const r = await math_handler.execute({ node_id: "n1", node_type: "math", operation: "currency", currency_action: "info", currency_code: "USD" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: eval + expression 없음 → 경고", () => {
    const r = math_handler.test({ node_id: "n1", node_type: "math", operation: "eval", expression: "" } as any);
    expect(r.warnings).toContain("expression is required for eval");
  });

  it("test: convert + from/to 없음 → 경고", () => {
    const r = math_handler.test({ node_id: "n1", node_type: "math", operation: "convert", from: "", to: "" } as any);
    expect(r.warnings).toContain("from and to units are required for convert");
  });
});

// ══════════════════════════════════════════
// hash_handler
// ══════════════════════════════════════════

describe("hash_handler — 미커버 분기", () => {
  it("create_default: action=hash", () => {
    const d = hash_handler.create_default?.();
    expect((d as any).action).toBe("hash");
  });

  it("execute: crc32 → ChecksumTool 위임 (L32-38)", async () => {
    const r = await hash_handler.execute({ node_id: "n1", node_type: "hash", action: "crc32", input: "hello" } as any, ctx);
    expect(r.output).toBeDefined();
    expect(typeof (r.output as any).digest).toBe("string");
  });

  it("execute: adler32 → ChecksumTool 위임", async () => {
    const r = await hash_handler.execute({ node_id: "n1", node_type: "hash", action: "adler32", input: "world" } as any, ctx);
    expect(r.output).toBeDefined();
  });
});

// ══════════════════════════════════════════
// text_handler
// ══════════════════════════════════════════

describe("text_handler — 미커버 분기", () => {
  it("create_default: operation=count", () => {
    const d = text_handler.create_default?.();
    expect((d as any).operation).toBe("count");
  });

  it("execute: filename_safe → SlugTool 위임 (L32-37)", async () => {
    const r = await text_handler.execute({ node_id: "n1", node_type: "text", operation: "filename_safe", input: "Hello World!" } as any, ctx);
    expect(r.output).toBeDefined();
    expect(typeof (r.output as any).result).toBe("string");
  });

  it("execute: transliterate → SlugTool 위임", async () => {
    const r = await text_handler.execute({ node_id: "n1", node_type: "text", operation: "transliterate", input: "Héllo Wörld" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: input 없음 → 경고", () => {
    const r = text_handler.test({ node_id: "n1", node_type: "text", operation: "count", input: "" } as any);
    expect(r.warnings).toContain("input is required");
  });
});

// ══════════════════════════════════════════
// stats_handler
// ══════════════════════════════════════════

describe("stats_handler — 미커버 분기", () => {
  it("create_default: operation=summary (L22)", () => {
    const d = stats_handler.create_default?.();
    expect((d as any).operation).toBe("summary");
  });

  it("execute: moving_average → TimeseriesTool 위임 (L33-45)", async () => {
    const r = await stats_handler.execute({ node_id: "n1", node_type: "stats", operation: "moving_average", data: "1,2,3,4,5", window: 3 } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: ema → TimeseriesTool 위임", async () => {
    const r = await stats_handler.execute({ node_id: "n1", node_type: "stats", operation: "ema", data: "1,2,3,4,5", alpha: 0.3 } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: data 없음 → 경고", () => {
    const r = stats_handler.test({ node_id: "n1", node_type: "stats", operation: "summary", data: "" } as any);
    expect(r.warnings).toContain("data is required");
  });

  it("test: correlation + data2 없음 → 경고", () => {
    const r = stats_handler.test({ node_id: "n1", node_type: "stats", operation: "correlation", data: "1,2,3", data2: "" } as any);
    expect(r.warnings).toContain("data2 is required for correlation");
  });
});
