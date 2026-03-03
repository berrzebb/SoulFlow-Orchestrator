import { describe, it, expect } from "vitest";
import { parse_execution_mode, detect_escalation } from "@src/orchestration/service.js";

describe("parse_execution_mode — ClassificationResult", () => {
  // === builtin 파싱 ===
  it("parses builtin with command + args", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"task","args":"list"}');
    expect(r).toEqual({ mode: "builtin", command: "task", args: "list" });
  });
  it("parses builtin without args", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"stop"}');
    expect(r).toEqual({ mode: "builtin", command: "stop", args: undefined });
  });
  it("rejects builtin without command field", () => {
    expect(parse_execution_mode('{"mode":"builtin"}')).toBeNull();
  });

  // === inquiry 파싱 ===
  it("parses inquiry from JSON", () => {
    expect(parse_execution_mode('{"mode":"inquiry"}')).toEqual({ mode: "inquiry" });
  });
  it("parses inquiry from word fallback", () => {
    expect(parse_execution_mode("inquiry")).toEqual({ mode: "inquiry" });
  });

  // === 기존 모드 (구조화된 반환) ===
  it("returns structured once/agent/task", () => {
    expect(parse_execution_mode('{"mode":"once"}')).toEqual({ mode: "once" });
    expect(parse_execution_mode('{"mode":"agent"}')).toEqual({ mode: "agent" });
    expect(parse_execution_mode('{"mode":"task"}')).toEqual({ mode: "task" });
  });
  it("word fallback returns structured result", () => {
    expect(parse_execution_mode("once")).toEqual({ mode: "once" });
    expect(parse_execution_mode("The mode should be agent")).toEqual({ mode: "agent" });
  });
  it("embedded JSON still works", () => {
    expect(parse_execution_mode('I think {"mode":"agent"} because...')).toEqual({ mode: "agent" });
  });

  // === 케이스 인센시티브 ===
  it("case insensitive for all modes", () => {
    expect(parse_execution_mode('{"mode":"BUILTIN","command":"task","args":"list"}')).toEqual({ mode: "builtin", command: "task", args: "list" });
    expect(parse_execution_mode('{"mode":"INQUIRY"}')).toEqual({ mode: "inquiry" });
    expect(parse_execution_mode('{"mode":"ONCE"}')).toEqual({ mode: "once" });
  });

  // === 에러 케이스 ===
  it("null for empty/invalid", () => {
    expect(parse_execution_mode("")).toBeNull();
    expect(parse_execution_mode("   ")).toBeNull();
    expect(parse_execution_mode('{"mode":"unknown"}')).toBeNull();
    expect(parse_execution_mode("random text")).toBeNull();
  });

  // === route 필드 호환 ===
  it("accepts route field as fallback", () => {
    expect(parse_execution_mode('{"route":"agent"}')).toEqual({ mode: "agent" });
  });

  // === JSON with extra fields ===
  it("handles JSON with extra fields", () => {
    expect(parse_execution_mode('{"mode":"agent","reason":"multi-step"}')).toEqual({ mode: "agent" });
  });

  it("prefers JSON mode over word match", () => {
    expect(parse_execution_mode('{"mode":"agent"} once')).toEqual({ mode: "agent" });
  });

  // === 중첩 중괄호 처리 ===
  it("handles args containing curly braces", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"memory","args":"search {pattern}"}');
    expect(r).toEqual({ mode: "builtin", command: "memory", args: "search {pattern}" });
  });
});

describe("detect_escalation", () => {
  it("exact match", () => {
    expect(detect_escalation("NEED_TASK_LOOP")).toBe("once_requires_task_loop");
    expect(detect_escalation("NEED_AGENT_LOOP")).toBe("once_requires_agent_loop");
  });
  it("whitespace/dash variations", () => {
    expect(detect_escalation("NEED TASK LOOP")).toBe("once_requires_task_loop");
    expect(detect_escalation("NEED-TASK-LOOP")).toBe("once_requires_task_loop");
    expect(detect_escalation("need task loop")).toBe("once_requires_task_loop");
  });
  it("embedded in longer text", () => {
    expect(detect_escalation("I think we NEED TASK LOOP here")).toBe("once_requires_task_loop");
  });
  it("normal text → null", () => {
    expect(detect_escalation("Everything is fine")).toBeNull();
    expect(detect_escalation("작업 완료")).toBeNull();
  });
});
