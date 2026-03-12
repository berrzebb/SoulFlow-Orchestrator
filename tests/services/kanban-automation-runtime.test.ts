/**
 * KanbanAutomationRuntime — notify, get_rule_executor, init_*, dispose 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanAutomationRuntime } from "@src/services/kanban-automation-runtime.js";

describe("KanbanAutomationRuntime", () => {
  it("notify_workflow_waiting — watcher 없으면 무시 (optional chain)", () => {
    const rt = new KanbanAutomationRuntime();
    expect(() => rt.notify_workflow_waiting("wf1")).not.toThrow();
  });

  it("get_rule_executor — 초기값 null", () => {
    const rt = new KanbanAutomationRuntime();
    expect(rt.get_rule_executor()).toBeNull();
  });

  it("dispose — 빈 상태에서도 오류 없이 실행", () => {
    const rt = new KanbanAutomationRuntime();
    expect(() => rt.dispose()).not.toThrow();
  });

  it("init_trigger_watcher — import 실패 시 warn만 기록 (catch 분기)", async () => {
    const rt = new KanbanAutomationRuntime();
    // kanban-trigger-watcher.js가 존재하면 성공, 없어도 catch로 처리됨
    await expect(rt.init_trigger_watcher({
      kanban_store: {} as any,
      workflow_store: {} as any,
      resumer: {} as any,
    })).resolves.toBeUndefined();
  });

  it("init_rule_executor — import 실패 시 warn만 기록 (catch 분기)", async () => {
    const rt = new KanbanAutomationRuntime();
    await expect(rt.init_rule_executor({} as any)).resolves.toBeUndefined();
  });

  it("dispose — watcher/executor mock 주입 후 dispose 호출", () => {
    const rt = new KanbanAutomationRuntime();
    const mock_watcher = { notify: vi.fn(), dispose: vi.fn() };
    const mock_executor = { dispose: vi.fn() };
    (rt as any).watcher = mock_watcher;
    (rt as any).executor = mock_executor;

    rt.dispose();
    expect(mock_watcher.dispose).toHaveBeenCalled();
    expect(mock_executor.dispose).toHaveBeenCalled();
    expect(rt.get_rule_executor()).toBeNull();
  });

  it("notify_workflow_waiting — watcher 있으면 notify 호출", () => {
    const rt = new KanbanAutomationRuntime();
    const mock_watcher = { notify: vi.fn(), dispose: vi.fn() };
    (rt as any).watcher = mock_watcher;
    rt.notify_workflow_waiting("wf1");
    expect(mock_watcher.notify).toHaveBeenCalledWith("wf1");
  });
});
