/**
 * TomlTool — 미커버 catch 분기 (cov2):
 * - L32: parse action → parse_toml throws → catch → error 반환
 * - L48: validate action → parse_toml throws → catch → { valid: false }
 * - L59: query action → parse_toml throws → catch → error 반환
 * - L69: merge action → parse_toml throws → catch → error 반환
 *
 * parse_toml은 lenient 파서라 실제 잘못된 TOML 입력으로는 throw하지 않음.
 * private 메서드 교체(mocker) 패턴으로 catch 분기를 강제 실행.
 */
import { describe, it, expect } from "vitest";
import { TomlTool } from "@src/agent/tools/toml.js";

function make_throwing_tool() {
  const tool = new TomlTool();
  // parse_toml을 throw하도록 교체 → 모든 케이스의 catch 분기 활성화
  (tool as any).parse_toml = () => { throw new Error("forced parse error"); };
  return tool;
}

async function run(tool: TomlTool, params: Record<string, unknown>): Promise<unknown> {
  const raw = await (tool as any).run(params);
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── L32: parse action → catch ─────────────────────────────────────────────────

describe("TomlTool — parse catch (L32)", () => {
  it("parse_toml throws → catch → { error } 반환 (L32)", async () => {
    const tool = make_throwing_tool();
    const result = await run(tool, { action: "parse", input: "anything" }) as any;
    expect(result.error).toBeDefined();
    expect(result.error).toContain("forced parse error");
  });
});

// ── L48: validate action → catch ─────────────────────────────────────────────

describe("TomlTool — validate catch (L48)", () => {
  it("parse_toml throws → catch → { valid: false, error } 반환 (L48)", async () => {
    const tool = make_throwing_tool();
    const result = await run(tool, { action: "validate", input: "anything" }) as any;
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

// ── L59: query action → catch ─────────────────────────────────────────────────

describe("TomlTool — query catch (L59)", () => {
  it("parse_toml throws → catch → { error } 반환 (L59)", async () => {
    const tool = make_throwing_tool();
    const result = await run(tool, { action: "query", input: "anything", path: "key" }) as any;
    expect(result.error).toBeDefined();
  });
});

// ── L69: merge action → catch ─────────────────────────────────────────────────

describe("TomlTool — merge catch (L69)", () => {
  it("parse_toml throws → catch → { error } 반환 (L69)", async () => {
    const tool = make_throwing_tool();
    const result = await run(tool, { action: "merge", input: "key = 1", second: "other = 2" }) as any;
    expect(result.error).toBeDefined();
  });
});
