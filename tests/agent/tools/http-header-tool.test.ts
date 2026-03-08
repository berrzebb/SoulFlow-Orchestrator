/**
 * HttpHeaderTool — HTTP 헤더 파싱/빌드/분석 테스트.
 */
import { describe, it, expect } from "vitest";
import { HttpHeaderTool } from "../../../src/agent/tools/http-header.js";

const tool = new HttpHeaderTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("HttpHeaderTool — parse", () => {
  it("Content-Type 헤더 파싱", async () => {
    const r = await exec({ action: "parse", header: "application/json; charset=utf-8" }) as Record<string, unknown>;
    expect(r.parts_count).toBeGreaterThan(0);
    const p = r.params as Record<string, string>;
    expect(p["application/json"]).toBeDefined();
    expect(p["charset"]).toBe("utf-8");
  });

  it("Accept 헤더 파싱 → 목록", async () => {
    const r = await exec({ action: "parse", header: "text/html, application/json" }) as Record<string, unknown>;
    expect(r.parts_count).toBe(2);
  });
});

describe("HttpHeaderTool — build", () => {
  it("헤더 객체 → 텍스트 형식", async () => {
    const headers = JSON.stringify({ "Content-Type": "application/json", "Accept": "text/html" });
    const r = await exec({ action: "build", headers }) as Record<string, unknown>;
    expect(String(r.text)).toContain("Content-Type: application/json");
    expect(r.count).toBe(2);
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "build", headers: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("HttpHeaderTool — content_type", () => {
  it("기본 Content-Type 생성", async () => {
    const r = await exec({ action: "content_type", type: "text/html" }) as Record<string, unknown>;
    expect(r.header).toBe("Content-Type");
    expect(String(r.value)).toContain("text/html");
  });

  it("파라미터 포함 Content-Type", async () => {
    const r = await exec({
      action: "content_type",
      type: "application/json",
      params: JSON.stringify({ charset: "utf-8" }),
    }) as Record<string, unknown>;
    expect(String(r.value)).toContain("charset=utf-8");
  });
});

describe("HttpHeaderTool — accept", () => {
  it("Accept 헤더 파싱 + 품질 정렬", async () => {
    const r = await exec({ action: "accept", header: "text/html;q=0.9, application/json;q=1.0" }) as Record<string, unknown>;
    const types = r.accept as { media_type: string; quality: number }[];
    expect(types[0]?.quality).toBeGreaterThanOrEqual(types[1]?.quality || 0);
  });
});

describe("HttpHeaderTool — cache_control", () => {
  it("Cache-Control 파싱", async () => {
    const r = await exec({ action: "cache_control", header: "max-age=3600, public, no-transform" }) as Record<string, unknown>;
    const d = r.directives as Record<string, unknown>;
    expect(d["max-age"]).toBe("3600");
    expect(d["public"]).toBe(true);
  });

  it("Cache-Control 빌드", async () => {
    const r = await exec({
      action: "cache_control",
      directives: JSON.stringify({ "max-age": 3600, "public": true }),
    }) as Record<string, unknown>;
    expect(String(r.value)).toContain("max-age=3600");
  });
});

describe("HttpHeaderTool — authorization", () => {
  it("Bearer 토큰 생성", async () => {
    const r = await exec({ action: "authorization", type: "Bearer", token: "mytoken123" }) as Record<string, unknown>;
    expect(String(r.value)).toBe("Bearer mytoken123");
  });

  it("Authorization 헤더 파싱", async () => {
    const r = await exec({ action: "authorization", header: "Bearer mytoken123" }) as Record<string, unknown>;
    expect(r.scheme).toBe("Bearer");
    expect(r.credentials).toBe("mytoken123");
  });
});
