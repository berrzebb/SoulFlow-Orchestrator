import { describe, it, expect } from "vitest";
import { HttpHeaderTool } from "../../src/agent/tools/http-header.js";

function make_tool() {
  return new HttpHeaderTool({ secret_vault: undefined as never });
}

describe("HttpHeaderTool", () => {
  describe("parse", () => {
    it("세미콜론 구분 파라미터 파싱", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "parse", header: "text/html; charset=utf-8" }));
      expect(r.params["text/html"]).toBeDefined();
      expect(r.params["charset"]).toBe("utf-8");
    });
  });

  describe("build", () => {
    it("헤더 객체 → 텍스트 변환", async () => {
      const headers = JSON.stringify({ "Content-Type": "application/json", "X-Custom": "value" });
      const r = JSON.parse(await make_tool().execute({ action: "build", headers }));
      expect(r.count).toBe(2);
      expect(r.text).toContain("Content-Type: application/json");
    });
  });

  describe("content_type", () => {
    it("Content-Type 헤더 생성", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "content_type", type: "multipart/form-data",
        params: JSON.stringify({ boundary: "abc123" }),
      }));
      expect(r.value).toContain("multipart/form-data");
      expect(r.value).toContain("boundary=abc123");
    });
  });

  describe("accept", () => {
    it("Accept 헤더 파싱 + 품질 순 정렬", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "accept", header: "text/html, application/json;q=0.9, */*;q=0.1",
      }));
      expect(r.preferred).toBe("text/html");
      expect(r.accept[0].quality).toBe(1.0);
      expect(r.accept.length).toBe(3);
    });
  });

  describe("cache_control", () => {
    it("Cache-Control 파싱", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "cache_control", header: "max-age=3600, no-cache, public",
      }));
      expect(r.directives["max-age"]).toBe("3600");
      expect(r.directives["no-cache"]).toBe(true);
      expect(r.directives["public"]).toBe(true);
    });

    it("Cache-Control 빌드", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "cache_control",
        directives: JSON.stringify({ "max-age": 600, "no-store": true }),
      }));
      expect(r.value).toContain("max-age=600");
      expect(r.value).toContain("no-store");
    });
  });

  describe("authorization", () => {
    it("Authorization 헤더 파싱", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "authorization", header: "Bearer abc123token",
      }));
      expect(r.scheme).toBe("Bearer");
      expect(r.credentials).toBe("abc123token");
    });

    it("Authorization 헤더 빌드", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "authorization", type: "Basic", token: "dXNlcjpwYXNz",
      }));
      expect(r.value).toBe("Basic dXNlcjpwYXNz");
    });
  });

  describe("content_disposition", () => {
    it("ASCII 파일명", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "content_disposition", filename: "report.pdf",
      }));
      expect(r.value).toContain('filename="report.pdf"');
    });

    it("비ASCII 파일명 → UTF-8 인코딩", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "content_disposition", filename: "보고서.pdf",
      }));
      expect(r.value).toContain("filename*=UTF-8''");
    });

    it("헤더 파싱", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "content_disposition", header: 'attachment; filename="test.zip"',
      }));
      expect(r.params["filename"]).toBe("test.zip");
    });
  });
});
