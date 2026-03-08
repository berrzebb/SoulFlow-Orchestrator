/**
 * VcardTool — vCard 생성/파싱/검증/JSON 변환 테스트.
 */
import { describe, it, expect } from "vitest";
import { VcardTool } from "../../../src/agent/tools/vcard.js";

const tool = new VcardTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const SAMPLE_VCARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Alice Smith\r\nN:Smith;Alice;;;\r\nEMAIL:alice@example.com\r\nTEL:+1234567890\r\nORG:Example Corp\r\nTITLE:Engineer\r\nURL:https://alice.example.com\r\nNOTE:A test contact\r\nEND:VCARD`;

describe("VcardTool — generate", () => {
  it("기본 vCard 생성", async () => {
    const r = String(await exec({ action: "generate", name: "Alice Smith", email: "alice@example.com" }));
    expect(r).toContain("BEGIN:VCARD");
    expect(r).toContain("END:VCARD");
    expect(r).toContain("FN:Alice Smith");
    expect(r).toContain("EMAIL:alice@example.com");
  });

  it("모든 필드 포함", async () => {
    const r = String(await exec({
      action: "generate",
      name: "Bob Jones",
      email: "bob@example.com",
      phone: "+9876543210",
      org: "ACME",
      title: "Manager",
      url: "https://bob.example.com",
      address: "123 Main St, City",
      note: "Test note",
    }));
    expect(r).toContain("TEL:+9876543210");
    expect(r).toContain("ORG:ACME");
    expect(r).toContain("TITLE:Manager");
    expect(r).toContain("URL:https://bob.example.com");
    expect(r).toContain("NOTE:Test note");
  });

  it("version 3.0 생성", async () => {
    const r = String(await exec({ action: "generate", name: "Test User", version: "3.0" }));
    expect(r).toContain("VERSION:3.0");
  });

  it("N 필드 분리 (이름/성)", async () => {
    const r = String(await exec({ action: "generate", name: "Alice Smith" }));
    expect(r).toContain("N:Smith;Alice;;;");
  });

  it("단일 이름 (성만)", async () => {
    const r = String(await exec({ action: "generate", name: "Alice" }));
    expect(r).toContain("FN:Alice");
  });
});

describe("VcardTool — parse / to_json", () => {
  it("vCard 파싱", async () => {
    const r = await exec({ action: "parse", vcard: SAMPLE_VCARD }) as Record<string, unknown>;
    expect(r.name).toBe("Alice Smith");
    expect(r.email).toBe("alice@example.com");
    expect(r.phone).toBe("+1234567890");
    expect(r.organization).toBe("Example Corp");
    expect(r.title).toBe("Engineer");
    expect(r.url).toBe("https://alice.example.com");
    expect(r.note).toBe("A test contact");
    expect(r.version).toBe("4.0");
  });

  it("to_json은 parse와 동일", async () => {
    const parse_r = await exec({ action: "parse", vcard: SAMPLE_VCARD });
    const json_r = await exec({ action: "to_json", vcard: SAMPLE_VCARD });
    expect(JSON.stringify(parse_r)).toBe(JSON.stringify(json_r));
  });

  it("ADR 필드 파싱", async () => {
    const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nADR:;;123 Main St;City;State;12345;US\r\nEND:VCARD";
    const r = await exec({ action: "parse", vcard }) as Record<string, unknown>;
    expect(String(r.address)).toContain("123 Main St");
  });
});

describe("VcardTool — validate", () => {
  it("유효한 vCard → valid: true", async () => {
    const r = await exec({ action: "validate", vcard: SAMPLE_VCARD }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("BEGIN:VCARD 없음 → error", async () => {
    const r = await exec({ action: "validate", vcard: "VERSION:4.0\nFN:Test\nEND:VCARD" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("BEGIN"))).toBe(true);
  });

  it("END:VCARD 없음 → error", async () => {
    const r = await exec({ action: "validate", vcard: "BEGIN:VCARD\nVERSION:4.0\nFN:Test" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("END"))).toBe(true);
  });

  it("FN 없음 → error", async () => {
    const r = await exec({ action: "validate", vcard: "BEGIN:VCARD\nVERSION:4.0\nEND:VCARD" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("FN"))).toBe(true);
  });
});

describe("VcardTool — from_json", () => {
  it("JSON 데이터에서 vCard 생성", async () => {
    const data = JSON.stringify({ name: "Carol White", email: "carol@example.com", org: "Corp" });
    const r = String(await exec({ action: "from_json", data }));
    expect(r).toContain("FN:Carol White");
    expect(r).toContain("EMAIL:carol@example.com");
    expect(r).toContain("ORG:Corp");
  });

  it("fn 필드도 name으로 처리", async () => {
    const data = JSON.stringify({ fn: "Dave Brown" });
    const r = String(await exec({ action: "from_json", data }));
    expect(r).toContain("FN:Dave Brown");
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "from_json", data: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
