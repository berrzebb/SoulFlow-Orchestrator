import { describe, it, expect } from "vitest";
import { ChecksumTool } from "@src/agent/tools/checksum.js";

const tool = new ChecksumTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("ChecksumTool — 기본 동작", () => {
  it("adler32 체크섬", async () => {
    const r = await exec({ action: "adler32", data: "hello" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("adler32");
    expect(typeof r.checksum).toBe("string");
  });

  it("sha256 체크섬", async () => {
    const r = await exec({ action: "sha256", data: "hello" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("sha256");
    expect(String(r.checksum).length).toBe(64);
  });

  it("hmac 생성", async () => {
    const r = await exec({ action: "hmac", data: "hello", key: "secret" }) as Record<string, unknown>;
    expect(String(r.algorithm)).toContain("hmac");
    expect(typeof r.checksum).toBe("string");
  });

  it("verify: sha256 일치", async () => {
    const hash_r = await exec({ action: "sha256", data: "hello" }) as Record<string, unknown>;
    const r = await exec({ action: "verify", data: "hello", expected: hash_r.checksum }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("compare: entries 비교", async () => {
    const r = await exec({
      action: "compare",
      entries: JSON.stringify([{ name: "a", data: "hello" }, { name: "b", data: "hello" }]),
    }) as Record<string, unknown>;
    expect(r.all_match).toBe(true);
  });

  it("manifest: 항목 목록 생성", async () => {
    const r = await exec({
      action: "manifest",
      entries: JSON.stringify([{ name: "file.txt", data: "content" }]),
    }) as Record<string, unknown>;
    expect(typeof r.manifest).toBe("string");
  });
});

describe("ChecksumTool — 미커버 분기", () => {
  it("verify: crc32 알고리즘 → L73 crc32 분기", async () => {
    const r = await exec({ action: "verify", data: "test", algorithm: "crc32", expected: "00000000" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("crc32");
  });

  it("compare: 잘못된 entries JSON → L82 catch", async () => {
    const r = await exec({ action: "compare", entries: "{invalid json}" }) as Record<string, unknown>;
    expect(String(r.error)).toContain("invalid entries JSON");
  });

  it("manifest: 잘못된 entries JSON → L94 catch", async () => {
    const r = await exec({ action: "manifest", entries: "{invalid}" }) as Record<string, unknown>;
    expect(String(r.error)).toContain("invalid entries JSON");
  });

  it("unknown action → L110 에러", async () => {
    const r = await exec({ action: "unknown_algo" }) as Record<string, unknown>;
    expect(String(r.error)).toContain("unknown action");
  });

  it("crc32 action → L60/61 실행", async () => {
    const r = await exec({ action: "crc32", data: "hello world" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("crc32");
    expect(typeof r.checksum).toBe("string");
  });

  it("verify: adler32 알고리즘 → L72 adler32 분기", async () => {
    const r = await exec({ action: "verify", data: "test", algorithm: "adler32", expected: "00000000" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("adler32");
  });

  it("hmac: key 없음 → L104 error", async () => {
    const r = await exec({ action: "hmac", data: "test" }) as Record<string, unknown>;
    expect(r.error).toContain("key is required");
  });
});
