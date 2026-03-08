/**
 * TomlTool — parse/generate/validate/query/merge 테스트.
 */
import { describe, it, expect } from "vitest";
import { TomlTool } from "../../../src/agent/tools/toml.js";

const tool = new TomlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_TOML = `
[package]
name = "my-app"
version = "1.0.0"

[dependencies]
vitest = "^4.0"
`;

describe("TomlTool — parse", () => {
  it("섹션 + 키/값 파싱", async () => {
    const r = await exec({ action: "parse", input: BASIC_TOML }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.package.name).toBe("my-app");
    expect(result.package.version).toBe("1.0.0");
  });

  it("전역 키 파싱", async () => {
    const r = await exec({ action: "parse", input: "title = \"Hello\"\ncount = 42" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.title).toBe("Hello");
    expect(result.count).toBe(42);
  });

  it("빈 입력 → 빈 result", async () => {
    const r = await exec({ action: "parse", input: "" }) as Record<string, unknown>;
    expect(r.result).toEqual({});
  });
});

describe("TomlTool — generate", () => {
  it("JSON → TOML 생성", async () => {
    const r = await exec({ action: "generate", input: JSON.stringify({ name: "test", version: "1.0.0" }) });
    const text = String(r);
    expect(text).toContain("name");
    expect(text).toContain("test");
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "generate", input: "not-json" });
    expect(String(r)).toContain("Error");
  });
});

describe("TomlTool — validate", () => {
  it("유효한 TOML → valid: true", async () => {
    const r = await exec({ action: "validate", input: BASIC_TOML }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("빈 입력도 유효", async () => {
    const r = await exec({ action: "validate", input: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });
});

describe("TomlTool — query", () => {
  it("점 경로로 값 조회", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML, path: "package.name" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(r.value).toBe("my-app");
  });

  it("존재하지 않는 경로 → found: false", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML, path: "package.nonexistent" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
  });

  it("path 없음 → Error", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML });
    expect(String(r)).toContain("Error");
  });
});

describe("TomlTool — merge", () => {
  it("두 TOML 병합 → 두 번째가 오버라이드", async () => {
    const first = "[db]\nhost = \"localhost\"\nport = 5432";
    const second = "[db]\nport = 9999\nssl = true";
    const r = await exec({ action: "merge", input: first, second }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, unknown>>;
    expect(result.db.host).toBe("localhost");
    expect(result.db.port).toBe(9999);
  });
});
