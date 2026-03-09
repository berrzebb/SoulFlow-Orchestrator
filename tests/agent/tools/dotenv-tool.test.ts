/**
 * DotenvTool — parse/generate/merge/validate/diff 테스트.
 */
import { describe, it, expect } from "vitest";
import { DotenvTool } from "../../../src/agent/tools/dotenv.js";

const tool = new DotenvTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_ENV = `
# 앱 설정
APP_NAME=MyApp
APP_PORT=3000
DB_URL="postgres://localhost/db"
SECRET_KEY='my secret key'
EMPTY_VAR=
`;

describe("DotenvTool — parse", () => {
  it("기본 .env 파싱 → variables + count", async () => {
    const r = await exec({ action: "parse", input: BASIC_ENV }) as Record<string, unknown>;
    const vars = r.variables as Record<string, string>;
    expect(vars.APP_NAME).toBe("MyApp");
    expect(vars.APP_PORT).toBe("3000");
    expect(vars.DB_URL).toBe("postgres://localhost/db");
    expect(vars.SECRET_KEY).toBe("my secret key");
    expect(r.count).toBe(5);
  });

  it("주석 및 빈 줄 무시", async () => {
    const r = await exec({ action: "parse", input: "# comment\n\nKEY=value" }) as Record<string, unknown>;
    const vars = r.variables as Record<string, string>;
    expect(Object.keys(vars)).toEqual(["KEY"]);
  });

  it("빈 입력 → count 0", async () => {
    const r = await exec({ action: "parse", input: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("인라인 주석 처리", async () => {
    const r = await exec({ action: "parse", input: "HOST=localhost # 인라인 주석" }) as Record<string, unknown>;
    const vars = r.variables as Record<string, string>;
    expect(vars.HOST).toBe("localhost");
  });
});

describe("DotenvTool — generate", () => {
  it("JSON 객체 → .env 형식 문자열 생성", async () => {
    const r = await exec({
      action: "generate",
      data: JSON.stringify({ APP_NAME: "Test", PORT: "8080" }),
    });
    const text = String(r);
    expect(text).toContain("APP_NAME=Test");
    expect(text).toContain("PORT=8080");
  });

  it("공백 포함 값 → 따옴표로 감쌈", async () => {
    const r = await exec({
      action: "generate",
      data: JSON.stringify({ GREETING: "hello world" }),
    });
    expect(String(r)).toContain('"hello world"');
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "generate", data: "{invalid" });
    expect(String(r)).toContain("Error");
  });
});

describe("DotenvTool — merge", () => {
  it("두 번째 .env가 첫 번째 값 오버라이드", async () => {
    const first = "HOST=localhost\nPORT=3000";
    const second = "PORT=9000\nDEBUG=true";
    const r = await exec({ action: "merge", input: first, second }) as Record<string, unknown>;
    const vars = r.variables as Record<string, string>;
    expect(vars.HOST).toBe("localhost");
    expect(vars.PORT).toBe("9000");
    expect(vars.DEBUG).toBe("true");
    expect(r.count).toBe(3);
  });

  it("from_first + from_second 카운트 포함", async () => {
    const r = await exec({ action: "merge", input: "A=1\nB=2", second: "C=3" }) as Record<string, unknown>;
    expect(r.from_first).toBe(2);
    expect(r.from_second).toBe(1);
  });
});

describe("DotenvTool — validate", () => {
  it("필수 키 모두 존재 → valid true", async () => {
    const r = await exec({
      action: "validate",
      input: "APP_NAME=x\nDB_URL=y",
      required_keys: "APP_NAME,DB_URL",
    }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.missing as string[]).length).toBe(0);
  });

  it("필수 키 누락 → valid false + missing 배열", async () => {
    const r = await exec({
      action: "validate",
      input: "APP_NAME=x",
      required_keys: "APP_NAME,DB_URL,SECRET",
    }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("DB_URL");
    expect(r.missing).toContain("SECRET");
  });

  it("빈 값 키 → empty 배열에 포함", async () => {
    const r = await exec({
      action: "validate",
      input: "KEY=",
      required_keys: "KEY",
    }) as Record<string, unknown>;
    expect(r.empty).toContain("KEY");
  });
});

describe("DotenvTool — diff", () => {
  it("added / removed / changed / unchanged 분류", async () => {
    const first = "A=1\nB=old\nC=same";
    const second = "B=new\nC=same\nD=added";
    const r = await exec({ action: "diff", input: first, second }) as Record<string, unknown>;
    expect(r.added).toContain("D");
    expect(r.removed).toContain("A");
    expect((r.changed as Array<Record<string, string>>)[0].key).toBe("B");
    expect(r.unchanged).toBe(1);
  });

  it("동일한 .env → added/removed 없음", async () => {
    const env = "X=1\nY=2";
    const r = await exec({ action: "diff", input: env, second: env }) as Record<string, unknown>;
    expect((r.added as string[]).length).toBe(0);
    expect((r.removed as string[]).length).toBe(0);
    expect(r.unchanged).toBe(2);
  });
});

// L71: unknown action → error (default branch)
describe("DotenvTool — unknown action (L71)", () => {
  it("알 수 없는 action → Error 반환 (L71)", async () => {
    const r = await tool.execute({ action: "unknown_action" });
    expect(String(r)).toContain("unsupported action");
  });
});
