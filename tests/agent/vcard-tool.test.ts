import { describe, it, expect } from "vitest";
import { VcardTool } from "@src/agent/tools/vcard.js";

function make_tool(): VcardTool {
  return new VcardTool();
}

describe("VcardTool", () => {
  describe("generate", () => {
    it("기본 vCard 4.0 생성", async () => {
      const tool = make_tool();
      const result = await tool.execute({
        action: "generate",
        name: "Hong Gildong",
        email: "gildong@example.com",
        phone: "+82-10-1234-5678",
      });
      expect(result).toContain("BEGIN:VCARD");
      expect(result).toContain("VERSION:4.0");
      expect(result).toContain("FN:Hong Gildong");
      expect(result).toContain("N:Gildong;Hong;;;");
      expect(result).toContain("EMAIL:gildong@example.com");
      expect(result).toContain("TEL:+82-10-1234-5678");
      expect(result).toContain("END:VCARD");
    });

    it("vCard 3.0 버전 지정", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "generate", name: "Test", version: "3.0" });
      expect(result).toContain("VERSION:3.0");
    });

    it("모든 필드 포함", async () => {
      const tool = make_tool();
      const result = await tool.execute({
        action: "generate",
        name: "Kim Minsoo",
        email: "min@test.com",
        phone: "010-0000-0000",
        org: "TestCorp",
        title: "Engineer",
        url: "https://test.com",
        address: "Seoul Korea",
        note: "Test note",
      });
      expect(result).toContain("ORG:TestCorp");
      expect(result).toContain("TITLE:Engineer");
      expect(result).toContain("URL:https://test.com");
      expect(result).toContain("ADR:;;Seoul Korea;;;;");
      expect(result).toContain("NOTE:Test note");
    });

    it("이름만 있으면 N 필드에 단일 이름", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "generate", name: "Madonna" });
      expect(result).toContain("N:Madonna;;;;");
    });
  });

  describe("parse / to_json", () => {
    it("vCard 문자열을 JSON으로 파싱", async () => {
      const tool = make_tool();
      const vcard = [
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Test User",
        "N:User;Test;;;",
        "EMAIL:test@example.com",
        "TEL:123-456",
        "ORG:MyOrg",
        "END:VCARD",
      ].join("\r\n");

      const result = await tool.execute({ action: "parse", vcard });
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Test User");
      expect(parsed.family_name).toBe("User");
      expect(parsed.given_name).toBe("Test");
      expect(parsed.email).toBe("test@example.com");
      expect(parsed.phone).toBe("123-456");
      expect(parsed.organization).toBe("MyOrg");
      expect(parsed.version).toBe("4.0");
    });

    it("to_json은 parse와 동일", async () => {
      const tool = make_tool();
      const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nEND:VCARD";
      const parse_result = await tool.execute({ action: "parse", vcard });
      const to_json_result = await tool.execute({ action: "to_json", vcard });
      expect(parse_result).toBe(to_json_result);
    });
  });

  describe("validate", () => {
    it("유효한 vCard → valid: true", async () => {
      const tool = make_tool();
      const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nEND:VCARD";
      const result = JSON.parse(await tool.execute({ action: "validate", vcard }));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("BEGIN:VCARD 누락 → 에러", async () => {
      const tool = make_tool();
      const result = JSON.parse(await tool.execute({ action: "validate", vcard: "FN:Test\r\nEND:VCARD" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("missing BEGIN:VCARD");
    });

    it("FN 누락 → 에러", async () => {
      const tool = make_tool();
      const result = JSON.parse(await tool.execute({ action: "validate", vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("missing FN (full name)");
    });

    it("VERSION 누락 → 에러", async () => {
      const tool = make_tool();
      const result = JSON.parse(await tool.execute({ action: "validate", vcard: "BEGIN:VCARD\r\nFN:Test\r\nEND:VCARD" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("missing VERSION");
    });
  });

  describe("from_json", () => {
    it("JSON 데이터로 vCard 생성", async () => {
      const tool = make_tool();
      const data = JSON.stringify({ name: "Park Jiyeon", email: "jy@test.com", org: "TestCo" });
      const result = await tool.execute({ action: "from_json", data });
      expect(result).toContain("BEGIN:VCARD");
      expect(result).toContain("FN:Park Jiyeon");
      expect(result).toContain("EMAIL:jy@test.com");
      expect(result).toContain("ORG:TestCo");
    });

    it("잘못된 JSON → 에러 반환", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "from_json", data: "not-json" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe("invalid JSON");
    });

    it("fn 키도 인식", async () => {
      const tool = make_tool();
      const data = JSON.stringify({ fn: "Lee Soojin", tel: "010-1111-2222" });
      const result = await tool.execute({ action: "from_json", data });
      expect(result).toContain("FN:Lee Soojin");
      expect(result).toContain("TEL:010-1111-2222");
    });
  });

  describe("unknown action", () => {
    it("알 수 없는 action → 에러", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "unknown_action" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("unknown action");
    });
  });

  describe("roundtrip", () => {
    it("generate → parse → from_json 왕복", async () => {
      const tool = make_tool();
      const generated = await tool.execute({
        action: "generate",
        name: "Kim Cheolsu",
        email: "cs@test.com",
        phone: "010-9999-8888",
      });

      const parsed_json = await tool.execute({ action: "parse", vcard: generated });
      const parsed = JSON.parse(parsed_json);
      expect(parsed.name).toBe("Kim Cheolsu");
      expect(parsed.email).toBe("cs@test.com");
    });
  });
});
