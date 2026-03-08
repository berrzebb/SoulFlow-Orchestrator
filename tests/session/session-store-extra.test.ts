/**
 * SessionStore — list_by_prefix, prune_expired, delete 추가 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@src/session/service.js";

let tmp_dir: string;
let store: SessionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "sess-extra-"));
  store = new SessionStore(tmp_dir, undefined, null);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

async function seed_session(key: string): Promise<void> {
  // append_message이 DB에 직접 저장
  await store.append_message(key, { role: "user", content: "hello" });
}

describe("SessionStore — list_by_prefix", () => {
  it("prefix로 세션 목록 필터링", async () => {
    await seed_session("team:alpha:chat1");
    await seed_session("team:alpha:chat2");
    await seed_session("team:beta:chat1");

    const results = await store.list_by_prefix("team:alpha");
    expect(results.length).toBe(2);
    expect(results.every((r) => r.key.startsWith("team:alpha"))).toBe(true);
  });

  it("일치하는 prefix 없음 → 빈 배열", async () => {
    await seed_session("team:alpha:chat1");
    const results = await store.list_by_prefix("team:gamma");
    expect(results).toEqual([]);
  });

  it("빈 prefix → 모든 세션 반환", async () => {
    await seed_session("sess:a");
    await seed_session("sess:b");
    const results = await store.list_by_prefix("");
    expect(results.length).toBe(2);
  });

  it("limit 적용", async () => {
    await seed_session("p:1");
    await seed_session("p:2");
    await seed_session("p:3");
    const results = await store.list_by_prefix("p:", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("결과에 message_count 포함", async () => {
    await store.append_message("mc:test", { role: "user", content: "hello" });
    await store.append_message("mc:test", { role: "assistant", content: "hi" });

    const results = await store.list_by_prefix("mc:");
    expect(results[0].message_count).toBe(2);
  });

  it("특수문자(%, _) prefix 이스케이프", async () => {
    await seed_session("test%like:session");
    await seed_session("other:session");

    const results = await store.list_by_prefix("test%like");
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("test%like:session");
  });
});

describe("SessionStore — prune_expired", () => {
  it("최근 세션은 삭제되지 않음", async () => {
    await seed_session("recent:session");
    const count = await store.prune_expired(60_000 * 60 * 24); // 24시간
    expect(count).toBe(0);
  });

  it("prune_expired 반환값 숫자 타입", async () => {
    const count = await store.prune_expired(60_000);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("SessionStore — delete", () => {
  it("존재하는 세션 삭제 → true", async () => {
    await seed_session("del:test");
    const result = await store.delete("del:test");
    expect(result).toBe(true);
  });

  it("삭제 후 재조회하면 새 세션 생성 가능", async () => {
    await seed_session("del:recreate");
    await store.delete("del:recreate");
    const results = await store.list_by_prefix("del:recreate");
    expect(results.length).toBe(0);
  });

  it("존재하지 않는 세션 삭제 → false", async () => {
    const result = await store.delete("ghost:session");
    expect(result).toBe(false);
  });
});
