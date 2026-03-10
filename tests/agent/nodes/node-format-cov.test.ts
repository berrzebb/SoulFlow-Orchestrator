/**
 * data_format / validator 노드 핸들러 — 미커버 분기 보충.
 * data_format: create_default + MIME/Header ops + catch
 * validator: create_default + email operation 분기
 */
import { describe, it, expect } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";
import { data_format_handler } from "@src/agent/nodes/data-format.js";
import { validator_handler } from "@src/agent/nodes/validator.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// data_format_handler
// ══════════════════════════════════════════

describe("data_format_handler — 미커버 분기", () => {
  it("create_default: operation=convert (L24)", () => {
    const d = data_format_handler.create_default?.();
    expect((d as any).operation).toBe("convert");
  });

  it("execute: mime_lookup → MimeTool 위임 (L34-47)", async () => {
    const r = await data_format_handler.execute({ node_id: "n1", node_type: "data_format", operation: "mime_lookup", mime_extension: "json" } as any, ctx);
    expect(r.output).toBeDefined();
    expect((r.output as any).success).toBe(true);
  });

  it("execute: mime_detect → MimeTool 위임", async () => {
    const r = await data_format_handler.execute({ node_id: "n1", node_type: "data_format", operation: "mime_detect", input: "test.json" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: header_parse → HttpHeaderTool 위임 (L55-74)", async () => {
    const r = await data_format_handler.execute({
      node_id: "n1", node_type: "data_format", operation: "header_parse",
      input: "Content-Type: application/json; charset=utf-8",
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: header_content_type → HttpHeaderTool 위임", async () => {
    const r = await data_format_handler.execute({
      node_id: "n1", node_type: "data_format", operation: "header_content_type",
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: input 없음 → 경고", () => {
    const r = data_format_handler.test({ node_id: "n1", node_type: "data_format", operation: "convert", input: "", from: "json", to: "csv" } as any);
    expect(r.warnings).toContain("input is required");
  });

  it("test: convert + from === to → 경고", () => {
    const r = data_format_handler.test({ node_id: "n1", node_type: "data_format", operation: "convert", input: "{}",  from: "json", to: "json" } as any);
    expect(r.warnings).toContain("from and to formats are the same");
  });
});

// ══════════════════════════════════════════
// validator_handler
// ══════════════════════════════════════════

describe("validator_handler — 미커버 분기", () => {
  it("create_default: operation=format (L23)", () => {
    const d = validator_handler.create_default?.();
    expect((d as any).operation).toBe("format");
  });

  it("execute: email validate → EmailValidateTool 위임 (L30-37)", async () => {
    const r = await validator_handler.execute({ node_id: "n1", node_type: "validator", operation: "email", email_action: "validate", input: "test@example.com" } as any, ctx);
    expect(r.output).toBeDefined();
    expect(typeof (r.output as any).valid).toBe("boolean");
  });

  it("execute: email parse (non-validate action) → 결과 직접 노출 (L40)", async () => {
    const r = await validator_handler.execute({ node_id: "n1", node_type: "validator", operation: "email", email_action: "parse", input: "test@example.com" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: schema + schema={} → 경고", () => {
    const r = validator_handler.test({ node_id: "n1", node_type: "validator", operation: "schema", input: "{}", schema: "{}" } as any);
    expect(r.warnings).toContain("schema is empty");
  });

  it("test: input 없음 → 경고", () => {
    const r = validator_handler.test({ node_id: "n1", node_type: "validator", operation: "format", input: "", format: "json" } as any);
    expect(r.warnings).toContain("input is required");
  });
});
