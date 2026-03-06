/**
 * PhaseWorkflowStore 통합 테스트 — 실제 SQLite.
 *
 * Mock이 잡지 못하는 시나리오:
 * 1. 워크플로우 CRUD가 실제 SQLite에서 동작
 * 2. 프로세스 재시작 후 워크플로우 상태 복원
 * 3. 에이전트 메시지 저장/조회
 * 4. 동시 upsert 안전성
 * 5. remove 후 메시지도 삭제
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhaseWorkflowStore } from "@src/agent/phase-workflow-store.js";
import type { PhaseLoopState, PhaseMessage } from "@src/agent/phase-loop.types.js";

let cleanup_dirs: string[] = [];

function make_state(patch?: Partial<PhaseLoopState>): PhaseLoopState {
  return {
    workflow_id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: "running",
    title: "Test Workflow",
    objective: "test objective",
    phases: [],
    current_phase_index: 0,
    channel: "telegram",
    chat_id: "chat-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  } as PhaseLoopState;
}

function make_message(role = "user", content = "hello"): PhaseMessage {
  return { role, content, at: new Date().toISOString() } as PhaseMessage;
}

async function make_store() {
  const dir = await mkdtemp(join(tmpdir(), "pw-integ-"));
  cleanup_dirs.push(dir);
  return { store: new PhaseWorkflowStore(join(dir, "workflows")), dir };
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("PhaseWorkflowStore 통합 (실제 SQLite)", () => {
  it("upsert → get → list CRUD", async () => {
    const { store } = await make_store();
    const state = make_state();

    await store.upsert(state);
    const got = await store.get(state.workflow_id);
    expect(got).not.toBeNull();
    expect(got!.title).toBe("Test Workflow");

    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("upsert가 기존 상태를 업데이트", async () => {
    const { store } = await make_store();
    const state = make_state();

    await store.upsert(state);
    state.status = "completed";
    state.current_phase_index = 2;
    await store.upsert(state);

    const got = await store.get(state.workflow_id);
    expect(got!.status).toBe("completed");
    expect(got!.current_phase_index).toBe(2);
  });

  it("프로세스 재시작 후 워크플로우 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pw-restart-"));
    cleanup_dirs.push(dir);
    const wf_dir = join(dir, "workflows");

    const store1 = new PhaseWorkflowStore(wf_dir);
    const state = make_state({ title: "Persist Test" });
    await store1.upsert(state);

    // 재시작
    const store2 = new PhaseWorkflowStore(wf_dir);
    const got = await store2.get(state.workflow_id);
    expect(got!.title).toBe("Persist Test");
  });

  it("에이전트 메시지 저장 + 조회", async () => {
    const { store } = await make_store();
    const state = make_state();
    await store.upsert(state);

    await store.insert_message(state.workflow_id, "phase-1", "agent-1", make_message("user", "질문"));
    await store.insert_message(state.workflow_id, "phase-1", "agent-1", make_message("assistant", "답변"));

    const msgs = await store.get_messages(state.workflow_id, "phase-1", "agent-1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("질문");
    expect(msgs[1].content).toBe("답변");
  });

  it("메시지는 재시작 후에도 보존", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pw-msg-restart-"));
    cleanup_dirs.push(dir);
    const wf_dir = join(dir, "workflows");

    const store1 = new PhaseWorkflowStore(wf_dir);
    const state = make_state();
    await store1.upsert(state);
    await store1.insert_message(state.workflow_id, "p1", "a1", make_message("user", "persisted"));

    const store2 = new PhaseWorkflowStore(wf_dir);
    const msgs = await store2.get_messages(state.workflow_id, "p1", "a1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("persisted");
  });

  it("remove 시 워크플로우 + 메시지 모두 삭제", async () => {
    const { store } = await make_store();
    const state = make_state();
    await store.upsert(state);
    await store.insert_message(state.workflow_id, "p1", "a1", make_message());

    const removed = await store.remove(state.workflow_id);
    expect(removed).toBe(true);

    const got = await store.get(state.workflow_id);
    expect(got).toBeNull();

    const msgs = await store.get_messages(state.workflow_id, "p1", "a1");
    expect(msgs).toHaveLength(0);
  });

  it("동시 upsert 안전성", async () => {
    const { store } = await make_store();
    const states = Array.from({ length: 20 }, (_, i) => make_state({ title: `Concurrent-${i}` }));

    await Promise.all(states.map((s) => store.upsert(s)));

    const list = await store.list();
    expect(list).toHaveLength(20);
  });

  it("존재하지 않는 워크플로우 get은 null", async () => {
    const { store } = await make_store();
    const got = await store.get("nonexistent-id");
    expect(got).toBeNull();
  });

  it("존재하지 않는 워크플로우 remove는 false", async () => {
    const { store } = await make_store();
    const removed = await store.remove("nonexistent-id");
    expect(removed).toBe(false);
  });

  it("다른 phase/agent의 메시지는 격리", async () => {
    const { store } = await make_store();
    const state = make_state();
    await store.upsert(state);

    await store.insert_message(state.workflow_id, "phase-1", "agent-1", make_message("user", "p1-a1"));
    await store.insert_message(state.workflow_id, "phase-1", "agent-2", make_message("user", "p1-a2"));
    await store.insert_message(state.workflow_id, "phase-2", "agent-1", make_message("user", "p2-a1"));

    const p1a1 = await store.get_messages(state.workflow_id, "phase-1", "agent-1");
    const p1a2 = await store.get_messages(state.workflow_id, "phase-1", "agent-2");
    const p2a1 = await store.get_messages(state.workflow_id, "phase-2", "agent-1");

    expect(p1a1).toHaveLength(1);
    expect(p1a1[0].content).toBe("p1-a1");
    expect(p1a2).toHaveLength(1);
    expect(p1a2[0].content).toBe("p1-a2");
    expect(p2a1).toHaveLength(1);
    expect(p2a1[0].content).toBe("p2-a1");
  });
});
