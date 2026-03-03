import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { WorkflowEventService } from "@src/events/service.ts";

describe("workflow events sqlite detail", () => {
  let workspace: string;
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  it("stores detail in sqlite and is readable by task id", async () => {
    workspace = await mkdtemp(join(tmpdir(), "events-sqlite-"));
    const events = new WorkflowEventService(workspace, join(workspace, "runtime", "events"));
    const task_id = "task-xyz";
    const detail = "step one\nstep two";

    const result = await events.append({
      phase: "progress",
      summary: "작업 진행",
      task_id,
      run_id: "run-1",
      agent_id: "assistant",
      chat_id: "chat-1",
      source: "system",
      detail,
    });

    expect(String(result.event.detail_file || "").startsWith("sqlite://events/task_details/")).toBe(true);

    const text = await events.read_task_detail(task_id);
    expect(text.includes("step one")).toBe(true);
    expect(text.includes("run=run-1")).toBe(true);
  });
});
