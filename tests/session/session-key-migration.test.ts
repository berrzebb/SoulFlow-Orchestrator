/**
 * SessionStore.migrate_legacy_keys + session_key team_id 테스트.
 *
 * 구 형식 → 신 형식 마이그레이션 + 병합 + 빈 세션 정리 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, Session } from "@src/session/service.js";

let tmp_dir: string;
let store: SessionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "sess-migrate-"));
  store = new SessionStore(tmp_dir, undefined, null);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ════════════════════════════════════════════════════
// migrate_legacy_keys: web 세션
// ════════════════════════════════════════════════════

describe("migrate_legacy_keys — web 세션", () => {
  it("구 형식 web 키를 신 형식으로 마이그레이션", async () => {
    // 구 형식: web:{chat_id}:{alias}:{thread}
    const old_key = "web:web_abc123:assistant:main";
    const session = new Session({ key: old_key });
    session.add_message("user", "hello");
    session.add_message("assistant", "hi there");
    await store.save(session);

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(1);

    // 신 형식으로 저장됨
    const new_key = "web:team1:user1:web_abc123:assistant:main";
    const loaded = await store.get_or_create(new_key);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe("hello");

    // 구 키는 삭제됨
    const entries = await store.list_by_prefix("web:web_abc123", 10);
    expect(entries).toHaveLength(0);
  });

  it("구+신 형식 동일 chat_id → 메시지 병합", async () => {
    const old_key = "web:web_merge1:assistant:main";
    const old_session = new Session({ key: old_key, created_at: "2026-01-01T00:00:00Z" });
    old_session.add_message("user", "old msg 1");
    old_session.add_message("assistant", "old msg 2");
    await store.save(old_session);

    const new_key = "web:team1:user1:web_merge1:assistant:main";
    const new_session = new Session({ key: new_key, created_at: "2026-03-01T00:00:00Z" });
    new_session.add_message("user", "new msg 1");
    await store.save(new_session);

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(1);

    const loaded = await store.get_or_create(new_key);
    // 구 메시지(2) + 신 메시지(1) = 3
    expect(loaded.messages).toHaveLength(3);
    expect(loaded.messages[0].content).toBe("old msg 1");
    expect(loaded.messages[2].content).toBe("new msg 1");
    // created_at은 구 세션의 값
    expect(loaded.created_at).toBe("2026-01-01T00:00:00Z");
  });

  it("빈 구 세션은 삭제만", async () => {
    const old_key = "web:web_empty:assistant:main";
    await store.save(new Session({ key: old_key }));

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(0);

    const entries = await store.list_by_prefix("web:", 100);
    expect(entries).toHaveLength(0);
  });

  it("이미 신 형식인 키는 건너뜀", async () => {
    const new_key = "web:team1:user1:web_ok:assistant:main";
    const session = new Session({ key: new_key });
    session.add_message("user", "keep");
    await store.save(session);

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(0);

    const loaded = await store.get_or_create(new_key);
    expect(loaded.messages).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════
// migrate_legacy_keys: 외부 채널 세션
// ════════════════════════════════════════════════════

describe("migrate_legacy_keys — 외부 채널 세션", () => {
  it("구 형식 slack 키를 신 형식으로 마이그레이션", async () => {
    const old_key = "slack:C12345:assistant:main";
    const session = new Session({ key: old_key });
    session.add_message("user", "slack msg");
    await store.save(session);

    const migrated = await store.migrate_legacy_keys("teamX", "userX");
    expect(migrated).toBe(1);

    // 외부 세션 신 형식: {provider}:{team_id}:{chat_id}:{alias}:{thread}
    const new_key = "slack:teamX:C12345:assistant:main";
    const loaded = await store.get_or_create(new_key);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe("slack msg");
  });

  it("구 형식 telegram 키를 신 형식으로 마이그레이션", async () => {
    const old_key = "telegram:6931693790:assistant:main";
    const session = new Session({ key: old_key });
    session.add_message("user", "tg msg");
    session.add_message("assistant", "tg reply");
    await store.save(session);

    const migrated = await store.migrate_legacy_keys("default", "user123");
    expect(migrated).toBe(1);

    const new_key = "telegram:default:6931693790:assistant:main";
    const loaded = await store.get_or_create(new_key);
    expect(loaded.messages).toHaveLength(2);
  });

  it("이미 신 형식인 외부 키는 건너뜀", async () => {
    const new_key = "slack:team1:C99999:assistant:main";
    const session = new Session({ key: new_key });
    session.add_message("user", "already migrated");
    await store.save(session);

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(0);
  });

  it("외부 채널 구+신 병합", async () => {
    const old_key = "slack:C12345:bot:1234";
    const old_session = new Session({ key: old_key, created_at: "2026-01-15T00:00:00Z" });
    old_session.add_message("user", "thread old");
    await store.save(old_session);

    const new_key = "slack:team1:C12345:bot:1234";
    const new_session = new Session({ key: new_key, created_at: "2026-03-10T00:00:00Z" });
    new_session.add_message("assistant", "thread new");
    await store.save(new_session);

    const migrated = await store.migrate_legacy_keys("team1", "user1");
    expect(migrated).toBe(1);

    const loaded = await store.get_or_create(new_key);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe("thread old");
    expect(loaded.messages[1].content).toBe("thread new");
  });
});

// ════════════════════════════════════════════════════
// 혼합 시나리오
// ════════════════════════════════════════════════════

describe("migrate_legacy_keys — 혼합 시나리오", () => {
  it("web + slack + telegram 레거시 키 동시 마이그레이션", async () => {
    const web = new Session({ key: "web:web_mix1:assistant:main" });
    web.add_message("user", "web");
    const slack = new Session({ key: "slack:C111:assistant:main" });
    slack.add_message("user", "slack");
    const tg = new Session({ key: "telegram:999:bot:main" });
    tg.add_message("user", "tg");
    // 이미 신 형식
    const ok = new Session({ key: "web:t:u:web_ok2:assistant:main" });
    ok.add_message("user", "ok");

    await Promise.all([store.save(web), store.save(slack), store.save(tg), store.save(ok)]);

    const migrated = await store.migrate_legacy_keys("t", "u");
    expect(migrated).toBe(3);

    // 총 4개 세션 (마이그레이션 3 + 기존 1)
    const all = await store.list_by_prefix("", 100);
    expect(all).toHaveLength(4);
  });

  it("두 번 실행해도 멱등", async () => {
    const session = new Session({ key: "slack:C222:assistant:main" });
    session.add_message("user", "idempotent");
    await store.save(session);

    await store.migrate_legacy_keys("t1", "u1");
    const second = await store.migrate_legacy_keys("t1", "u1");
    expect(second).toBe(0);

    const loaded = await store.get_or_create("slack:t1:C222:assistant:main");
    expect(loaded.messages).toHaveLength(1);
  });
});
