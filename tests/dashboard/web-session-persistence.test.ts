/**
 * capture_web_outbound / _restore_web_sessions 직접 검증.
 * 재시작 복원, assistant append, team/user 격리 케이스.
 *
 * 대상: src/dashboard/service.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, Session } from "@src/session/service.js";
import { DashboardService } from "@src/dashboard/service.js";
import type { DashboardOptions, ChatSession } from "@src/dashboard/service.types.js";

let tmp_dir: string;
let store: SessionStore;
let svc: DashboardService;

function make_options(s: SessionStore, ws: string): DashboardOptions {
  return {
    host: "localhost",
    port: 0,
    workspace: ws,
    session_store: s,
    default_alias: "default",
    agent: { list_subagents: () => [], list_runtime_tasks: () => [], list_stored_tasks: async () => [], list_active_loops: () => [], list_approval_requests: () => [] } as any,
    bus: { publish_inbound: async () => {} } as any,
    channels: { get_status: () => ({ enabled_channels: [], mention_loop_running: false }), get_channel_health: () => [], get_active_run_count: () => 0 } as any,
    heartbeat: { get_status: () => ({ alive: true }) } as any,
    ops: {} as any,
    decisions: { list: async () => [] } as any,
    promises: { list: async () => [] } as any,
    events: { list: async () => [] } as any,
  };
}

/** DashboardService 내부 _chat_sessions 맵 접근. */
function chat_sessions(s: DashboardService): Map<string, ChatSession> {
  return (s as any)._chat_sessions;
}

/** _restore_web_sessions 직접 호출 (private). */
async function restore(s: DashboardService): Promise<void> {
  return (s as any)._restore_web_sessions();
}

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "ws-persist-"));
  store = new SessionStore(tmp_dir, undefined, null);
  svc = new DashboardService(make_options(store, tmp_dir));
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// _restore_web_sessions
// ══════════════════════════════════════════

describe("_restore_web_sessions", () => {
  it("6-part web 키 → team_id/user_id/chat_id 정확히 복원", async () => {
    const key = "web:team_1:user_a:web_abc:default:main";
    const session = new Session({ key });
    session.add_message("user", "hello");
    session.add_message("assistant", "hi there");
    await store.save(session);

    await restore(svc);

    const map = chat_sessions(svc);
    expect(map.size).toBe(1);
    const restored = map.get("web_abc");
    expect(restored).toBeDefined();
    expect(restored!.team_id).toBe("team_1");
    expect(restored!.user_id).toBe("user_a");
    expect(restored!.messages).toHaveLength(2);
    expect(restored!.messages[0].direction).toBe("user");
    expect(restored!.messages[0].content).toBe("hello");
    expect(restored!.messages[1].direction).toBe("assistant");
  });

  it("5-part 미만 키는 스킵", async () => {
    // 레거시 4-part: migrate_legacy_keys 미실행 시 잔존 가능
    await store.save(new Session({ key: "web:chat1:alias:main", messages: [{ role: "user", content: "old", timestamp: "" }] as any }));
    (await store.get_or_create("web:chat1:alias:main")).add_message("user", "old");
    await store.save(await store.get_or_create("web:chat1:alias:main"));

    await restore(svc);

    expect(chat_sessions(svc).size).toBe(0);
  });

  it("서로 다른 team/user 세션 독립 복원", async () => {
    const s1 = new Session({ key: "web:team_1:user_a:chat_1:default:main" });
    s1.add_message("user", "team1 user_a msg");
    const s2 = new Session({ key: "web:team_2:user_b:chat_2:default:main" });
    s2.add_message("user", "team2 user_b msg");
    await Promise.all([store.save(s1), store.save(s2)]);

    await restore(svc);

    const map = chat_sessions(svc);
    expect(map.size).toBe(2);

    const c1 = map.get("chat_1")!;
    expect(c1.team_id).toBe("team_1");
    expect(c1.user_id).toBe("user_a");

    const c2 = map.get("chat_2")!;
    expect(c2.team_id).toBe("team_2");
    expect(c2.user_id).toBe("user_b");
  });

  it("빈 SessionStore → 세션 없음", async () => {
    await restore(svc);
    expect(chat_sessions(svc).size).toBe(0);
  });

  it("같은 chat_id 중복 키 → 먼저 로드된 것만 유지", async () => {
    const s1 = new Session({ key: "web:team_1:user_a:dup_chat:default:main" });
    s1.add_message("user", "first");
    const s2 = new Session({ key: "web:team_1:user_b:dup_chat:default:main" });
    s2.add_message("user", "second");
    await Promise.all([store.save(s1), store.save(s2)]);

    await restore(svc);

    const map = chat_sessions(svc);
    // chat_id 중복 시 먼저 나온 것만 로드 (list_by_prefix 순서 의존)
    expect(map.size).toBe(1);
    expect(map.has("dup_chat")).toBe(true);
  });

  it("외부 채널 키(slack:)는 무시", async () => {
    const external = new Session({ key: "slack:team_1:C123:bot:main" });
    external.add_message("user", "slack msg");
    const web = new Session({ key: "web:team_1:user_a:web_x:default:main" });
    web.add_message("user", "web msg");
    await Promise.all([store.save(external), store.save(web)]);

    await restore(svc);

    const map = chat_sessions(svc);
    // web: 프리픽스만 복원, slack: 무시
    expect(map.size).toBe(1);
    expect(map.has("web_x")).toBe(true);
  });
});

// ══════════════════════════════════════════
// capture_web_outbound
// ══════════════════════════════════════════

describe("capture_web_outbound", () => {
  it("기존 세션에 assistant 메시지 추가", async () => {
    // 세션 복원으로 chat_sessions 등록
    const s = new Session({ key: "web:t1:u1:cap_test:default:main" });
    s.add_message("user", "question");
    await store.save(s);
    await restore(svc);

    svc.capture_web_outbound("cap_test", "answer");

    const session = chat_sessions(svc).get("cap_test")!;
    expect(session.messages).toHaveLength(2);
    expect(session.messages[1].direction).toBe("assistant");
    expect(session.messages[1].content).toBe("answer");
  });

  it("SessionStore에도 영속화", async () => {
    const s = new Session({ key: "web:t1:u1:persist_test:default:main" });
    s.add_message("user", "q");
    await store.save(s);
    await restore(svc);

    svc.capture_web_outbound("persist_test", "a");

    // append_message는 비동기이므로 약간의 지연 필요
    await new Promise((r) => setTimeout(r, 50));

    const loaded = await store.get_or_create("web:t1:u1:persist_test:default:main");
    const last = loaded.messages[loaded.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("a");
  });

  it("존재하지 않는 chat_id → no-op (에러 없음)", () => {
    expect(() => svc.capture_web_outbound("nonexistent", "msg")).not.toThrow();
  });

  it("team_id/user_id가 store key에 반영", async () => {
    const s = new Session({ key: "web:teamX:userY:key_test:default:main" });
    s.add_message("user", "check key");
    await store.save(s);
    await restore(svc);

    svc.capture_web_outbound("key_test", "response");
    await new Promise((r) => setTimeout(r, 50));

    // store key는 web:{team_id}:{user_id}:{chat_id}:{alias}:main
    const loaded = await store.get_or_create("web:teamX:userY:key_test:default:main");
    expect(loaded.messages.length).toBeGreaterThanOrEqual(2);
    expect(loaded.messages[loaded.messages.length - 1].content).toBe("response");
  });
});

// ══════════════════════════════════════════
// 재시작 시나리오 (restore → capture → restore)
// ══════════════════════════════════════════

describe("재시작 시나리오", () => {
  it("capture → 새 인스턴스 restore → 메시지 유지", async () => {
    // 1. 첫 인스턴스: 세션 생성 + assistant 캡처
    const s = new Session({ key: "web:t1:u1:restart_test:default:main" });
    s.add_message("user", "before restart");
    await store.save(s);
    await restore(svc);
    svc.capture_web_outbound("restart_test", "assistant reply");
    await new Promise((r) => setTimeout(r, 50));

    // 2. 새 인스턴스 (재시작 시뮬레이션)
    const svc2 = new DashboardService(make_options(store, tmp_dir));
    await restore(svc2);

    const restored = chat_sessions(svc2).get("restart_test");
    expect(restored).toBeDefined();
    expect(restored!.messages.length).toBeGreaterThanOrEqual(2);
    // assistant reply가 영속화되어 복원됨
    const has_reply = restored!.messages.some((m) => m.content === "assistant reply");
    expect(has_reply).toBe(true);
  });

  it("다른 팀 세션은 혼재하지 않음 (격리 검증)", async () => {
    const s1 = new Session({ key: "web:team_A:user_1:iso_1:default:main" });
    s1.add_message("user", "team A");
    const s2 = new Session({ key: "web:team_B:user_2:iso_2:default:main" });
    s2.add_message("user", "team B");
    await Promise.all([store.save(s1), store.save(s2)]);

    await restore(svc);

    const c1 = chat_sessions(svc).get("iso_1")!;
    const c2 = chat_sessions(svc).get("iso_2")!;

    // 각 세션의 team_id/user_id가 독립
    expect(c1.team_id).toBe("team_A");
    expect(c1.user_id).toBe("user_1");
    expect(c2.team_id).toBe("team_B");
    expect(c2.user_id).toBe("user_2");

    // capture_web_outbound도 올바른 세션에만 영향
    svc.capture_web_outbound("iso_1", "reply to A");
    expect(c1.messages).toHaveLength(2); // user + assistant
    expect(c2.messages).toHaveLength(1); // user만
  });
});
