/**
 * AgentSessionStore — SQLite 기반 에이전트 세션 저장소 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStore } from "@src/agent/agent-session-store.js";

let tmp_dir: string;
let store: AgentSessionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "agent-sess-"));
  store = new AgentSessionStore(join(tmp_dir, "sessions.db"));
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

function make_session(patch: { session_id?: string; backend?: string } = {}) {
  return {
    session_id: patch.session_id ?? "sess-001",
    backend: (patch.backend ?? "claude_cli") as any,
    created_at: new Date().toISOString(),
  };
}

describe("AgentSessionStore — save + find_by_task", () => {
  it("task_id로 저장 후 조회", () => {
    store.save(make_session({ session_id: "s1" }), { task_id: "task-abc" });
    const found = store.find_by_task("task-abc");
    expect(found).not.toBeNull();
    expect(found!.session_id).toBe("s1");
    expect(found!.task_id).toBe("task-abc");
  });

  it("없는 task_id → null 반환", () => {
    expect(store.find_by_task("nonexistent-task")).toBeNull();
  });

  it("metadata 저장 + 조회", () => {
    store.save(make_session({ session_id: "s2" }), {
      task_id: "task-meta",
      metadata: { run_id: "r1", attempt: 3 },
    });
    const found = store.find_by_task("task-meta");
    expect(found!.metadata).toEqual({ run_id: "r1", attempt: 3 });
  });

  it("metadata 없이 저장 → metadata undefined", () => {
    store.save(make_session({ session_id: "s3" }), { task_id: "task-no-meta" });
    const found = store.find_by_task("task-no-meta");
    expect(found!.metadata).toBeUndefined();
  });

  it("동일 session_id 재저장 → 업데이트 (upsert)", () => {
    const sess = make_session({ session_id: "s4" });
    store.save(sess, { task_id: "task-original" });
    store.save(sess, { task_id: "task-original", metadata: { updated: true } });

    const found = store.find_by_task("task-original");
    expect(found!.metadata?.updated).toBe(true);
  });

  it("task_id 없이 저장 → task_id undefined", () => {
    store.save(make_session({ session_id: "s5" }));
    // task_id로 찾으면 null (task_id가 없으므로)
    expect(store.find_by_task("")).toBeNull();
  });
});

describe("AgentSessionStore — backend 필드 보존", () => {
  it("backend 타입 저장 + 조회", () => {
    store.save({ session_id: "s6", backend: "codex_cli" as any, created_at: new Date().toISOString() }, { task_id: "t6" });
    const found = store.find_by_task("t6");
    expect(found!.backend).toBe("codex_cli");
  });
});

describe("AgentSessionStore — prune_expired", () => {
  it("TTL 내 세션은 삭제 안 됨 → 0 반환", () => {
    store.save(make_session({ session_id: "s7" }), { task_id: "t7" });
    const count = store.prune_expired();
    expect(count).toBe(0);
    expect(store.find_by_task("t7")).not.toBeNull();
  });

  it("TTL이 0인 store: 저장 즉시 만료 → prune 후 조회 불가", () => {
    // TTL 1ms로 즉시 만료
    const expired_store = new AgentSessionStore(join(tmp_dir, "expired.db"), 1);
    expired_store.save(make_session({ session_id: "s8" }), { task_id: "t8" });
    // 잠깐 기다림
    const start = Date.now();
    while (Date.now() - start < 5) {} // 5ms busy wait
    const count = expired_store.prune_expired();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("비어 있는 DB에서 prune → 0 반환", () => {
    expect(store.prune_expired()).toBe(0);
  });
});
