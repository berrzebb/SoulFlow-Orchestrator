/**
 * IniTool — parse/generate/validate/query/merge 테스트.
 */
import { describe, it, expect } from "vitest";
import { IniTool } from "../../../src/agent/tools/ini.js";

const tool = new IniTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_INI = `
; 전역 설정
version = 1.0

[database]
host = localhost
port = 5432
name = mydb

[server]
host = 0.0.0.0
port = 8080
`;

describe("IniTool — parse", () => {
  it("섹션 + 키/값 파싱 → result + sections", async () => {
    const r = await exec({ action: "parse", input: BASIC_INI }) as Record<string, unknown>;
    expect(r.sections).toContain("database");
    expect(r.sections).toContain("server");
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.database.host).toBe("localhost");
    expect(result.database.port).toBe("5432");
  });

  it("주석(; #) 무시", async () => {
    const r = await exec({ action: "parse", input: "; 주석\n# 주석2\nkey=value" }) as Record<string, unknown>;
    const result = r.result as Record<string, string>;
    expect(result.key).toBe("value");
    expect(Object.keys(result)).not.toContain(";");
  });

  it("따옴표 값 → 따옴표 제거", async () => {
    const r = await exec({ action: "parse", input: '[sec]\npath = "C:/Program Files"' }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.sec.path).toBe("C:/Program Files");
  });

  it("빈 입력 → 빈 result", async () => {
    const r = await exec({ action: "parse", input: "" }) as Record<string, unknown>;
    expect(r.sections).toEqual([]);
  });
});

describe("IniTool — generate", () => {
  it("JSON 객체 → INI 문자열 생성", async () => {
    const data = {
      database: { host: "localhost", port: "5432" },
      server: { port: "8080" },
    };
    const r = await exec({ action: "generate", data: JSON.stringify(data) });
    const text = String(r);
    expect(text).toContain("[database]");
    expect(text).toContain("host = localhost");
    expect(text).toContain("[server]");
  });

  it("전역 키(섹션 없음) 생성", async () => {
    const r = await exec({ action: "generate", data: JSON.stringify({ version: "2.0" }) });
    expect(String(r)).toContain("version = 2.0");
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "generate", data: "{bad" });
    expect(String(r)).toContain("Error");
  });
});

describe("IniTool — validate", () => {
  it("유효한 INI → valid true", async () => {
    const r = await exec({ action: "validate", input: BASIC_INI }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("빈 입력도 유효", async () => {
    const r = await exec({ action: "validate", input: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });
});

describe("IniTool — query", () => {
  it("section + key → 특정 값 조회", async () => {
    const r = await exec({ action: "query", input: BASIC_INI, section: "database", key: "host" }) as Record<string, unknown>;
    expect(r.value).toBe("localhost");
    expect(r.found).toBe(true);
  });

  it("존재하지 않는 키 → found false", async () => {
    const r = await exec({ action: "query", input: BASIC_INI, section: "database", key: "password" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
    expect(r.value).toBeNull();
  });

  it("section만 전달 → 섹션 전체 값 반환", async () => {
    const r = await exec({ action: "query", input: BASIC_INI, section: "server" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    const values = r.values as Record<string, string>;
    expect(values.port).toBe("8080");
  });

  it("section 없이 호출 → 섹션 목록 반환", async () => {
    // BASIC_INI: 전역 key(version) + [database] + [server] = 3개 항목
    const r = await exec({ action: "query", input: BASIC_INI }) as Record<string, unknown>;
    expect(Array.isArray(r.sections)).toBe(true);
    expect(r.sections).toContain("database");
    expect(r.sections).toContain("server");
  });
});

describe("IniTool — merge", () => {
  it("두 INI 병합 → 두 번째가 오버라이드", async () => {
    const first = "[db]\nhost=localhost\nport=5432";
    const second = "[db]\nport=9999\nssl=true";
    const r = await exec({ action: "merge", input: first, second }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.db.host).toBe("localhost");
    expect(result.db.port).toBe("9999");
    expect(result.db.ssl).toBe("true");
  });

  it("두 번째에만 있는 섹션도 포함", async () => {
    const r = await exec({ action: "merge", input: "[a]\nk=1", second: "[b]\nk=2" }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.a).toBeDefined();
    expect(result.b).toBeDefined();
  });
});
