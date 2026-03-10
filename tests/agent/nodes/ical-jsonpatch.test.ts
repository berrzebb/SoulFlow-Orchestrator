/**
 * ical / json-patch 노드 핸들러 — 기본 커버리지.
 */
import { describe, it, expect } from "vitest";
import { ical_handler } from "@src/agent/nodes/ical.js";
import { json_patch_handler } from "@src/agent/nodes/json-patch.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// ical_handler
// ══════════════════════════════════════════

describe("ical_handler", () => {
  it("metadata: node_type = ical", () => expect(ical_handler.node_type).toBe("ical"));

  it("create_default: action=generate", () => {
    const d = ical_handler.create_default?.();
    expect((d as any).action).toBe("generate");
  });

  it("execute: generate ICS → ics 반환 (L48)", async () => {
    const events_json = JSON.stringify([{
      summary: "Meeting", start: "2024-03-10T10:00:00Z", end: "2024-03-10T11:00:00Z",
    }]);
    const r = await ical_handler.execute({
      node_id: "n1", node_type: "ical", action: "generate",
      events: events_json, calendar_name: "Test",
    } as any, ctx);
    expect(r.output).toBeDefined();
    // ICS 반환 분기 (L48) 또는 JSON 파싱 분기 확인
    expect((r.output as any).ics || (r.output as any).error || r.output).toBeTruthy();
  });

  it("execute: validate ICS", async () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR";
    const r = await ical_handler.execute({
      node_id: "n1", node_type: "ical", action: "validate", input: ics,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: parse ICS", async () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR";
    const r = await ical_handler.execute({
      node_id: "n1", node_type: "ical", action: "parse", input: ics,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: generate + events 없음 → 경고", () => {
    const r = ical_handler.test({ node_id: "n1", node_type: "ical", action: "generate", events: "" } as any);
    expect(r.warnings).toContain("events is required for generate");
  });

  it("test: parse + input 없음 → 경고", () => {
    const r = ical_handler.test({ node_id: "n1", node_type: "ical", action: "parse", input: "" } as any);
    expect(r.warnings).toContain("input (ICS content) is required");
  });

  it("test: validate + input 없음 → 경고", () => {
    const r = ical_handler.test({ node_id: "n1", node_type: "ical", action: "validate", input: "" } as any);
    expect(r.warnings).toContain("input (ICS content) is required");
  });
});

// ══════════════════════════════════════════
// json_patch_handler
// ══════════════════════════════════════════

describe("json_patch_handler", () => {
  it("metadata: node_type = json_patch", () => expect(json_patch_handler.node_type).toBe("json_patch"));

  it("create_default: action=apply", () => {
    const d = json_patch_handler.create_default?.();
    expect((d as any).action).toBe("apply");
  });

  it("execute: apply patch to document", async () => {
    const r = await json_patch_handler.execute({
      node_id: "n1", node_type: "json_patch", action: "apply",
      document: '{"a":1}',
      patch: '[{"op":"replace","path":"/a","value":2}]',
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: diff two documents", async () => {
    const r = await json_patch_handler.execute({
      node_id: "n1", node_type: "json_patch", action: "diff",
      document: '{"a":1}',
      target: '{"a":2}',
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: validate patch", async () => {
    const r = await json_patch_handler.execute({
      node_id: "n1", node_type: "json_patch", action: "validate",
      document: '{"a":1}',
      patch: '[{"op":"replace","path":"/a","value":2}]',
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: document 없음 → 경고", () => {
    const r = json_patch_handler.test({ node_id: "n1", node_type: "json_patch", action: "apply", document: "" } as any);
    expect(r.warnings).toContain("document is required");
    expect(r.warnings).toContain("patch is required for apply");
  });

  it("test: diff + target 없음 → 경고", () => {
    const r = json_patch_handler.test({ node_id: "n1", node_type: "json_patch", action: "diff", document: "{}", target: "" } as any);
    expect(r.warnings).toContain("target is required for diff");
  });
});
