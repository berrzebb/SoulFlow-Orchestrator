import { describe, it, expect } from "vitest";
import { YamlTool } from "@src/agent/tools/yaml.js";

function make_tool(): YamlTool {
  return new YamlTool();
}

describe("YamlTool", () => {
  describe("parse", () => {
    it("기본 YAML → JSON", async () => {
      const yaml = "name: Alice\nage: 30\ncity: Seoul";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result.name).toBe("Alice");
      expect(result.age).toBe(30);
      expect(result.city).toBe("Seoul");
    });

    it("중첩 객체", async () => {
      const yaml = "db:\n  host: localhost\n  port: 5432";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result.db.host).toBe("localhost");
      expect(result.db.port).toBe(5432);
    });

    it("시퀀스", async () => {
      const yaml = "- apple\n- banana\n- cherry";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result).toEqual(["apple", "banana", "cherry"]);
    });

    it("불리언/null 스칼라", async () => {
      const yaml = "enabled: true\ndisabled: false\nempty: null";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.empty).toBeNull();
    });

    it("주석/문서 구분자 무시", async () => {
      const yaml = "---\n# comment\nname: test\n...";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result.name).toBe("test");
    });

    it("따옴표 문자열", async () => {
      const yaml = "name: 'Alice'\ngreeting: \"hello\"";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: yaml }));
      expect(result.name).toBe("Alice");
      expect(result.greeting).toBe("hello");
    });
  });

  describe("generate", () => {
    it("JSON → YAML", async () => {
      const data = JSON.stringify({ name: "Alice", age: 30 });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("name: Alice");
      expect(result).toContain("age: 30");
    });

    it("중첩 객체", async () => {
      const data = JSON.stringify({ db: { host: "localhost", port: 5432 } });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("db:");
      expect(result).toContain("  host: localhost");
    });

    it("배열", async () => {
      const data = JSON.stringify({ items: ["a", "b", "c"] });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("- a");
      expect(result).toContain("- b");
    });

    it("빈 객체/배열", async () => {
      const data = JSON.stringify({ empty_obj: {}, empty_arr: [] });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("{}");
      expect(result).toContain("[]");
    });

    it("잘못된 JSON → 에러", async () => {
      const result = await make_tool().execute({ action: "generate", data: "not-json" });
      expect(result).toContain("Error");
    });
  });

  describe("merge", () => {
    it("두 YAML 객체 합병", async () => {
      const y1 = "name: Alice\nage: 30";
      const y2 = "city: Seoul\nage: 31";
      const result = await make_tool().execute({ action: "merge", data: y1, data2: y2 });
      expect(result).toContain("name: Alice");
      expect(result).toContain("age: 31"); // y2가 우선
      expect(result).toContain("city: Seoul");
    });

    it("deep merge", async () => {
      const y1 = "db:\n  host: localhost\n  port: 5432";
      const y2 = "db:\n  port: 3306\n  name: mydb";
      const result = await make_tool().execute({ action: "merge", data: y1, data2: y2 });
      expect(result).toContain("host: localhost");
      expect(result).toContain("port: 3306");
      expect(result).toContain("name: mydb");
    });
  });

  describe("validate", () => {
    it("유효한 YAML → valid: true", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "validate", data: "name: test" }));
      expect(result.valid).toBe(true);
    });
  });

  describe("query", () => {
    it("dot-notation 경로 쿼리", async () => {
      const yaml = "db:\n  host: localhost\n  port: 5432";
      const result = JSON.parse(await make_tool().execute({ action: "query", data: yaml, path: "db.host" }));
      expect(result.result).toBe("localhost");
    });

    it("없는 경로 → null", async () => {
      const yaml = "a: 1";
      const result = JSON.parse(await make_tool().execute({ action: "query", data: yaml, path: "b.c" }));
      expect(result.result).toBeNull();
    });

    it("path 없으면 에러", async () => {
      const result = await make_tool().execute({ action: "query", data: "a: 1" });
      expect(result).toContain("Error");
    });
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope", data: "" });
    expect(result).toContain("unsupported action");
  });
});
