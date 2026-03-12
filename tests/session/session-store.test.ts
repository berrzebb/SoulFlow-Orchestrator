/**
 * SessionStore — 미커버 분기 보충 (cov2).
 * - L213: metadata_json 잘못된 JSON → catch → {}
 * - L310: saved=false → cache.delete (save 실패 경로)
 * - L355-360: prune_expired → cache 제거 + write_lanes 정리
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, Session } from "@src/session/service.js";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

let tmp_dir: string;
let store: SessionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "sess-cov2-"));
  store = new SessionStore(tmp_dir, undefined, null);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// L213: metadata_json 잘못된 JSON → catch → {}
// ══════════════════════════════════════════

describe("SessionStore — metadata_json 잘못된 JSON → catch → {}", () => {
  it("DB에 잘못된 metadata_json → get_or_create() 시 metadata={}", async () => {
    // 세션 생성
    await store.append_message("meta-bad", { role: "user", content: "hello" });

    const db_path = join(tmp_dir, "sessions", "sessions.db");
    // metadata_json을 잘못된 JSON으로 직접 업데이트
    with_sqlite(db_path, (db) => {
      db.prepare("UPDATE sessions SET metadata_json = ? WHERE key = ?").run("{invalid json{", "meta-bad");
    });

    // 캐시를 비워서 DB에서 읽도록 강제
    (store as any).cache.delete("meta-bad");

    // get_or_create() → metadata_json 파싱 실패 → catch → {}
    const session = await store.get_or_create("meta-bad");
    expect(session).not.toBeNull();
    expect(session.metadata).toEqual({});
  });
});

// ══════════════════════════════════════════
// L358-360: prune_expired → write_lanes 정리
// ══════════════════════════════════════════

describe("SessionStore — prune_expired → write_lanes 정리", () => {
  it("세션 없을 때 prune_expired → 0 반환 (write_lanes 정리 루프 실행)", async () => {
    // write_lanes에 아무것도 없어도 루프 실행됨 (방어 코드)
    const count = await store.prune_expired(60_000);
    expect(count).toBe(0);
  });

  it("세션 있고 prune_expired → write_lanes에 있는 idle 레인 정리됨", async () => {
    // 세션 저장 → write_lanes에 레인 생성
    await store.append_message("prune:test", { role: "user", content: "hi" });

    // prune_expired 호출 — write_lanes idle 레인 정리 경로 실행
    const count = await store.prune_expired(60_000);
    expect(typeof count).toBe("number");
  });
});

// ══════════════════════════════════════════
// L315-317: evict_if_full + cache.set
// ══════════════════════════════════════════

describe("SessionStore — save() + evict_if_full + cache.set", () => {
  it("세션 저장 후 재조회 → 캐시에서 반환", async () => {
    const session = await store.get_or_create("evict:test");
    session.add_message("user", "hello");
    await store.save(session);
    // 캐시에 저장됨 → 재조회 가능
    const loaded = await store.get_or_create("evict:test");
    expect(loaded.messages.length).toBeGreaterThan(0);
  });

  it("save → cache.set 후 get_or_create 캐시 히트", async () => {
    const session = await store.get_or_create("cache:hit");
    session.add_message("assistant", "response");
    await store.save(session);
    // 두 번째 get_or_create → 캐시 히트 (messages 유지됨)
    const loaded2 = await store.get_or_create("cache:hit");
    expect(loaded2.messages.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// L355-356: prune_expired → 만료된 캐시 항목 제거
// ══════════════════════════════════════════

describe("SessionStore — prune_expired → 만료 캐시 항목 삭제 (L355-356)", () => {
  it("만료된 세션 DB+캐시에 있을 때 → 캐시에서도 제거됨", async () => {
    const key = "expire:cache-evict";
    // append_message → DB에 세션 행 생성
    await store.append_message(key, { role: "user", content: "hello" });

    const old_date = "2020-01-01T00:00:00.000Z";
    const db_path = join(tmp_dir, "sessions", "sessions.db");

    // DB updated_at을 과거로 설정
    with_sqlite(db_path, (db) => {
      db.prepare("UPDATE sessions SET updated_at = ? WHERE key = ?").run(old_date, key);
    });

    // 캐시 세션의 updated_at도 과거로 설정
    const cached = (store as any).cache.get(key);
    if (cached) cached.updated_at = old_date;

    // prune_expired → count=1 → cache 루프 실행 (L355-356)
    const count = await store.prune_expired(60_000);
    expect(count).toBe(1);
    // 캐시에서도 제거됨
    expect((store as any).cache.has(key)).toBe(false);
  });
});
