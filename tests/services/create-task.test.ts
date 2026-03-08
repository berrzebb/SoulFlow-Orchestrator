/**
 * create_task_service — 팩토리 함수 + 에러 처리 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { create_task_service, type CreateTaskDeps } from "../../src/services/create-task.service.js";

describe("create_task_service", () => {
  it("성공: deps.execute 호출 후 결과 반환", async () => {
    const execute = vi.fn().mockResolvedValue({ task_id: "t1", status: "completed", result: "done" });
    const deps: CreateTaskDeps = { execute };
    const svc = create_task_service(() => deps);

    const result = await svc({ title: "Test Task", objective: "Do something" });
    expect(result.status).toBe("completed");
    expect(result.task_id).toBe("t1");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Test Task",
        objective: "Do something",
        channel: "workflow",
        chat_id: "internal",
      }),
    );
  });

  it("성공: channel/chat_id 커스텀 값 전달", async () => {
    const execute = vi.fn().mockResolvedValue({ task_id: "t2", status: "ok" });
    const svc = create_task_service(() => ({ execute }));

    await svc({ title: "T", objective: "O", channel: "slack", chat_id: "C123" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "slack", chat_id: "C123" }),
    );
  });

  it("실패: deps.execute 에러 시 status=failed 반환", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("timeout"));
    const svc = create_task_service(() => ({ execute }));

    const result = await svc({ title: "Fail", objective: "X" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("timeout");
    expect(result.task_id).toBeTruthy();
  });

  it("task_id 폴백: deps.execute 결과에 task_id 없으면 자체 생성", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "ok" });
    const svc = create_task_service(() => ({ execute }));

    const result = await svc({ title: "T", objective: "O" });
    expect(result.task_id).toMatch(/^task_/);
  });
});
