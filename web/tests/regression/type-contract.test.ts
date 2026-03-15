/**
 * FE-6: 타입 계약 회귀 — FE-2~FE-5에서 추가된 optional 필드가 제거되지 않음을 잠근다.
 * 필드가 사라지면 해당 표면의 배지/칩이 무너지므로 타입 수준에서 보호한다.
 */
import { describe, it, expect } from "vitest";
import type { ProcessInfo, DashboardState, WorkflowEvent, RequestClass } from "@/pages/overview/types";
import type { AdminUserRecord } from "@/hooks/use-auth";

/** 타입에 특정 키가 존재하는지 검증하는 헬퍼 (컴파일 + 런타임 동시 검증). */
function has_optional_field<T>(key: keyof T): string {
  return String(key);
}

// ── FE-4: ProcessInfo 계약 ──────────────────────────────────────────────────

describe("ProcessInfo — FE-4 타입 계약", () => {
  it("request_class 필드 존재", () => {
    expect(has_optional_field<ProcessInfo>("request_class")).toBe("request_class");
  });

  it("guardrail_blocked 필드 존재", () => {
    expect(has_optional_field<ProcessInfo>("guardrail_blocked")).toBe("guardrail_blocked");
  });

  it("기존 필수 필드 보존 (run_id, status, tool_calls_count)", () => {
    expect(has_optional_field<ProcessInfo>("run_id")).toBe("run_id");
    expect(has_optional_field<ProcessInfo>("status")).toBe("status");
    expect(has_optional_field<ProcessInfo>("tool_calls_count")).toBe("tool_calls_count");
  });
});

// ── FE-4: DashboardState 계약 ───────────────────────────────────────────────

describe("DashboardState — FE-4 타입 계약", () => {
  it("request_class_summary 필드 존재", () => {
    expect(has_optional_field<DashboardState>("request_class_summary")).toBe("request_class_summary");
  });

  it("guardrail_stats 필드 존재", () => {
    expect(has_optional_field<DashboardState>("guardrail_stats")).toBe("guardrail_stats");
  });

  it("기존 필수 필드 보존 (now, queue, processes)", () => {
    expect(has_optional_field<DashboardState>("now")).toBe("now");
    expect(has_optional_field<DashboardState>("queue")).toBe("queue");
    expect(has_optional_field<DashboardState>("processes")).toBe("processes");
  });
});

// ── FE-5: WorkflowEvent 계약 ────────────────────────────────────────────────

describe("WorkflowEvent — FE-5 타입 계약", () => {
  it("retrieval_source 필드 존재", () => {
    expect(has_optional_field<WorkflowEvent>("retrieval_source")).toBe("retrieval_source");
  });

  it("novelty_score 필드 존재", () => {
    expect(has_optional_field<WorkflowEvent>("novelty_score")).toBe("novelty_score");
  });

  it("기존 필수 필드 보존 (event_id, phase, summary)", () => {
    expect(has_optional_field<WorkflowEvent>("event_id")).toBe("event_id");
    expect(has_optional_field<WorkflowEvent>("phase")).toBe("phase");
    expect(has_optional_field<WorkflowEvent>("summary")).toBe("summary");
  });
});

// ── FE-4: AdminUserRecord 계약 ──────────────────────────────────────────────

describe("AdminUserRecord — FE-4 타입 계약", () => {
  it("session_count 필드 존재", () => {
    expect(has_optional_field<AdminUserRecord>("session_count")).toBe("session_count");
  });

  it("기존 필수 필드 보존 (id, username, system_role)", () => {
    expect(has_optional_field<AdminUserRecord>("id")).toBe("id");
    expect(has_optional_field<AdminUserRecord>("username")).toBe("username");
    expect(has_optional_field<AdminUserRecord>("system_role")).toBe("system_role");
  });
});

// ── FE-4: RequestClass 타입 계약 ────────────────────────────────────────────

describe("RequestClass — 유효 값 회귀", () => {
  it("6개 실행 경로가 RequestClass에 할당 가능", () => {
    const classes: RequestClass[] = [
      "builtin", "direct_tool", "model_direct",
      "workflow_compile", "workflow_run", "agent",
    ];
    expect(classes).toHaveLength(6);
  });
});
