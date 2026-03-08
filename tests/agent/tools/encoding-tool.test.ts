/**
 * EncodingTool — encode/decode/hash/uuid 테스트.
 */
import { describe, it, expect } from "vitest";
import { EncodingTool } from "../../../src/agent/tools/encoding.js";

const tool = new EncodingTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("EncodingTool — encode", () => {
  it("base64 인코딩", async () => {
    const result = await exec({ operation: "encode", input: "hello", format: "base64" });
    expect(result).toBe(Buffer.from("hello").toString("base64"));
  });

  it("hex 인코딩", async () => {
    const result = await exec({ operation: "encode", input: "hello", format: "hex" });
    expect(result).toBe(Buffer.from("hello").toString("hex"));
  });

  it("url 인코딩", async () => {
    const result = await exec({ operation: "encode", input: "hello world!", format: "url" });
    expect(result).toBe("hello%20world!");
  });

  it("input 없음 → 에러 반환", async () => {
    const result = await exec({ operation: "encode", format: "base64" });
    expect(String(result)).toContain("Error");
  });

  it("지원하지 않는 format → 에러", async () => {
    const result = await exec({ operation: "encode", input: "test", format: "invalid" });
    expect(String(result)).toContain("Error");
  });
});

describe("EncodingTool — decode", () => {
  it("base64 디코딩", async () => {
    const encoded = Buffer.from("hello world").toString("base64");
    const result = await exec({ operation: "decode", input: encoded, format: "base64" });
    expect(result).toBe("hello world");
  });

  it("hex 디코딩", async () => {
    const encoded = Buffer.from("hello").toString("hex");
    const result = await exec({ operation: "decode", input: encoded, format: "hex" });
    expect(result).toBe("hello");
  });

  it("url 디코딩", async () => {
    const result = await exec({ operation: "decode", input: "hello%20world", format: "url" });
    expect(result).toBe("hello world");
  });

  it("input 없음 → 에러", async () => {
    const result = await exec({ operation: "decode", format: "base64" });
    expect(String(result)).toContain("Error");
  });
});

describe("EncodingTool — hash", () => {
  it("sha256 해시", async () => {
    const result = await exec({ operation: "hash", input: "hello", format: "sha256" });
    expect(String(result).length).toBe(64); // sha256 hex = 64 chars
  });

  it("sha512 해시", async () => {
    const result = await exec({ operation: "hash", input: "hello", format: "sha512" });
    expect(String(result).length).toBe(128);
  });

  it("md5 해시", async () => {
    const result = await exec({ operation: "hash", input: "hello", format: "md5" });
    expect(String(result).length).toBe(32);
  });

  it("같은 입력 → 동일 해시", async () => {
    const a = await exec({ operation: "hash", input: "test123", format: "sha256" });
    const b = await exec({ operation: "hash", input: "test123", format: "sha256" });
    expect(a).toBe(b);
  });
});

describe("EncodingTool — uuid", () => {
  it("기본값: UUID 1개 생성", async () => {
    const result = await exec({ operation: "uuid" });
    const uuids = Array.isArray(result) ? result : [result];
    expect(uuids.length).toBeGreaterThan(0);
    expect(String(uuids[0])).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("count=3 → \n 구분 3개 UUID", async () => {
    // count>1이면 \n으로 구분된 문자열 반환
    const raw = await tool.execute({ operation: "uuid", count: 3 });
    const uuids = String(raw).split("\n").filter(Boolean);
    expect(uuids.length).toBe(3);
  });

  it("각 UUID 고유함", async () => {
    const raw = await tool.execute({ operation: "uuid", count: 5 });
    const uuids = String(raw).split("\n").filter(Boolean);
    const unique = new Set(uuids);
    expect(unique.size).toBe(uuids.length);
  });
});

describe("EncodingTool — 기타", () => {
  it("지원하지 않는 operation → 에러", async () => {
    const result = await exec({ operation: "invalid" });
    expect(String(result)).toContain("Error");
  });
});
