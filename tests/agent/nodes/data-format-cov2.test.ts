/**
 * data-format handler — 미커버 분기 (cov2):
 * - L49: MIME 연산 → MimeTool.execute throw → success:false
 * - L76: HTTP header 연산 → HttpHeaderTool.execute throw → success:false
 * - L96: DataFormatTool.execute throw → success:false
 *
 * 참고: vi.mock은 최상위 레벨에서만 hoisting됨.
 */
import { describe, it, expect, vi } from "vitest";

// MimeTool과 HttpHeaderTool을 throw하도록 mock
vi.mock("@src/agent/tools/mime.js", () => ({
  MimeTool: class {
    execute() { throw new Error("mime forced error"); }
  },
}));

vi.mock("@src/agent/tools/http-header.js", () => ({
  HttpHeaderTool: class {
    execute() { throw new Error("http-header forced error"); }
  },
}));

vi.mock("@src/agent/tools/data-format.js", () => ({
  DataFormatTool: class {
    execute() { throw new Error("data-format forced error"); }
  },
}));

import { data_format_handler } from "@src/agent/nodes/data-format.js";

const CTX = { memory: {} } as any;

describe("data_format_handler — MIME 연산 에러 경로 (L49)", () => {
  it("mime_lookup → MimeTool throw → success:false", async () => {
    const result = await data_format_handler.execute!(
      { node_id: "n1", node_type: "data_format", title: "T", operation: "mime_lookup", input: "image/png", mime_extension: "png", mime_filename: "" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
    expect(String(result.output.result)).toContain("mime forced error");
  });

  it("mime_detect → MimeTool throw → success:false", async () => {
    const result = await data_format_handler.execute!(
      { node_id: "n1", node_type: "data_format", title: "T", operation: "mime_detect", input: "test.png", mime_extension: "", mime_filename: "test.png" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
  });
});

describe("data_format_handler — HTTP header 연산 에러 경로 (L76)", () => {
  it("header_parse → HttpHeaderTool throw → success:false", async () => {
    const result = await data_format_handler.execute!(
      { node_id: "n1", node_type: "data_format", title: "T", operation: "header_parse", input: "Content-Type: text/plain" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
    expect(String(result.output.result)).toContain("http-header forced error");
  });

  it("header_content_type → HttpHeaderTool throw → success:false", async () => {
    const result = await data_format_handler.execute!(
      { node_id: "n1", node_type: "data_format", title: "T", operation: "header_content_type", input: "text/html" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
  });
});

describe("data_format_handler — DataFormatTool 에러 경로 (L96)", () => {
  it("convert → DataFormatTool throw → success:false", async () => {
    const result = await data_format_handler.execute!(
      { node_id: "n1", node_type: "data_format", title: "T", operation: "convert", input: "{}", from: "json", to: "csv" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
    expect(String(result.output.result)).toContain("data-format forced error");
  });
});
