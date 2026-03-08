/**
 * MimeTool — MIME 타입 조회/감지/파싱 테스트.
 */
import { describe, it, expect } from "vitest";
import { MimeTool } from "../../../src/agent/tools/mime.js";

const tool = new MimeTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("MimeTool — lookup", () => {
  it(".json → application/json", async () => {
    const r = await exec({ action: "lookup", extension: ".json" }) as Record<string, unknown>;
    expect(r.mime).toBe("application/json");
  });

  it(".png → image/png", async () => {
    const r = await exec({ action: "lookup", extension: "png" }) as Record<string, unknown>;
    expect(r.mime).toBe("image/png");
  });

  it(".html → text/html", async () => {
    const r = await exec({ action: "lookup", extension: ".html" }) as Record<string, unknown>;
    expect(r.mime).toBe("text/html");
  });

  it("알 수 없는 확장자 → application/octet-stream", async () => {
    const r = await exec({ action: "lookup", extension: ".xyz_unknown" }) as Record<string, unknown>;
    expect(r.mime).toBe("application/octet-stream");
  });

  it("파일명으로 MIME 조회", async () => {
    const r = await exec({ action: "lookup", filename: "photo.jpg" }) as Record<string, unknown>;
    expect(r.mime).toBe("image/jpeg");
  });
});

describe("MimeTool — reverse_lookup", () => {
  it("MIME → 확장자 목록", async () => {
    const r = await exec({ action: "reverse_lookup", mime: "image/jpeg" }) as Record<string, unknown>;
    const exts = r.extensions as string[];
    expect(exts).toContain(".jpg");
    expect(exts).toContain(".jpeg");
  });

  it("알 수 없는 MIME → 빈 배열", async () => {
    const r = await exec({ action: "reverse_lookup", mime: "unknown/type" }) as Record<string, unknown>;
    expect((r.extensions as string[]).length).toBe(0);
  });
});

describe("MimeTool — detect", () => {
  it("파일명으로 MIME 감지", async () => {
    const r = await exec({ action: "detect", filename: "report.pdf" }) as Record<string, unknown>;
    expect(r.mime).toBe("application/pdf");
    expect(r.extension).toBe(".pdf");
  });

  it("확장자 없는 파일 → octet-stream", async () => {
    const r = await exec({ action: "detect", filename: "Makefile" }) as Record<string, unknown>;
    expect(r.mime).toBe("application/octet-stream");
  });
});

describe("MimeTool — parse", () => {
  it("MIME 타입 파싱", async () => {
    const r = await exec({ action: "parse", mime: "text/html; charset=utf-8" }) as Record<string, unknown>;
    expect(r.type).toBe("text");
    expect(r.subtype).toBe("html");
    const params = r.parameters as Record<string, string>;
    expect(params.charset).toBe("utf-8");
  });

  it("단순 MIME 파싱", async () => {
    const r = await exec({ action: "parse", mime: "application/json" }) as Record<string, unknown>;
    expect(r.type).toBe("application");
    expect(r.subtype).toBe("json");
  });
});

describe("MimeTool — is_text / is_binary", () => {
  it("text/plain → is_text: true", async () => {
    const r = await exec({ action: "is_text", mime: "text/plain" }) as Record<string, unknown>;
    expect(r.is_text).toBe(true);
  });

  it("image/png → is_text: false", async () => {
    const r = await exec({ action: "is_text", mime: "image/png" }) as Record<string, unknown>;
    expect(r.is_text).toBe(false);
  });

  it("image/png → is_binary: true", async () => {
    const r = await exec({ action: "is_binary", mime: "image/png" }) as Record<string, unknown>;
    expect(r.is_binary).toBe(true);
  });

  it("application/json → is_binary: false", async () => {
    const r = await exec({ action: "is_binary", mime: "application/json" }) as Record<string, unknown>;
    expect(r.is_binary).toBe(false);
  });
});

describe("MimeTool — list", () => {
  it("전체 MIME 목록 반환", async () => {
    const r = await exec({ action: "list" }) as Record<string, unknown>;
    expect(Number(r.count)).toBeGreaterThan(30);
    const entries = r.entries as Record<string, string>;
    expect(entries[".json"]).toBe("application/json");
  });
});
