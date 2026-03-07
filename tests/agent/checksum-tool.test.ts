import { describe, it, expect } from "vitest";
import { ChecksumTool } from "../../src/agent/tools/checksum.js";

function make_tool() {
  return new ChecksumTool({ secret_vault: undefined as never });
}

describe("ChecksumTool", () => {
  describe("adler32", () => {
    it("adler32 체크섬 계산", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "adler32", data: "hello" }));
      expect(r.algorithm).toBe("adler32");
      expect(r.checksum).toMatch(/^[0-9a-f]{8}$/);
      expect(r.decimal).toBeGreaterThan(0);
    });
  });

  describe("crc32", () => {
    it("crc32 체크섬 계산", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "crc32", data: "hello" }));
      expect(r.algorithm).toBe("crc32");
      expect(r.checksum).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("sha256", () => {
    it("sha256 해시", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "sha256", data: "hello" }));
      expect(r.algorithm).toBe("sha256");
      expect(r.checksum).toHaveLength(64);
    });

    it("다른 알고리즘 지정 가능", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "sha256", data: "hello", algorithm: "md5" }));
      expect(r.algorithm).toBe("md5");
      expect(r.checksum).toHaveLength(32);
    });
  });

  describe("verify", () => {
    it("올바른 체크섬 → match=true", async () => {
      const tool = make_tool();
      const hash = JSON.parse(await tool.execute({ action: "sha256", data: "test" }));
      const r = JSON.parse(await tool.execute({ action: "verify", data: "test", expected: hash.checksum }));
      expect(r.match).toBe(true);
    });

    it("잘못된 체크섬 → match=false", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "verify", data: "test", expected: "wrong" }));
      expect(r.match).toBe(false);
    });

    it("adler32 알고리즘으로 검증", async () => {
      const tool = make_tool();
      const hash = JSON.parse(await tool.execute({ action: "adler32", data: "abc" }));
      const r = JSON.parse(await tool.execute({ action: "verify", data: "abc", expected: hash.checksum, algorithm: "adler32" }));
      expect(r.match).toBe(true);
    });
  });

  describe("compare", () => {
    it("동일 데이터 → all_match=true", async () => {
      const entries = JSON.stringify([{ name: "a.txt", data: "same" }, { name: "b.txt", data: "same" }]);
      const r = JSON.parse(await make_tool().execute({ action: "compare", entries }));
      expect(r.all_match).toBe(true);
    });

    it("다른 데이터 → all_match=false", async () => {
      const entries = JSON.stringify([{ name: "a.txt", data: "aaa" }, { name: "b.txt", data: "bbb" }]);
      const r = JSON.parse(await make_tool().execute({ action: "compare", entries }));
      expect(r.all_match).toBe(false);
    });
  });

  describe("manifest", () => {
    it("매니페스트 생성", async () => {
      const entries = JSON.stringify([{ name: "file1.txt", data: "hello" }, { name: "file2.txt", data: "world" }]);
      const r = JSON.parse(await make_tool().execute({ action: "manifest", entries }));
      expect(r.entries).toHaveLength(2);
      expect(r.manifest).toContain("file1.txt");
      expect(r.manifest).toContain("file2.txt");
    });
  });

  describe("hmac", () => {
    it("HMAC 계산", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "hmac", data: "message", key: "secret" }));
      expect(r.algorithm).toBe("hmac-sha256");
      expect(r.checksum).toHaveLength(64);
    });

    it("키 없으면 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "hmac", data: "test" }));
      expect(r.error).toContain("key");
    });
  });
});
