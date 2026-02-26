import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowEventService } from "../src/events/service.ts";

test("workflow event detail is stored in sqlite and readable by task id", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "events-sqlite-"));
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

  assert.equal(String(result.event.detail_file || "").startsWith("sqlite://events/task_details/"), true);

  const text = await events.read_task_detail(task_id);
  assert.equal(text.includes("step one"), true);
  assert.equal(text.includes("run=run-1"), true);
});

