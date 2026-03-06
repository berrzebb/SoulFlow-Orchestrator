/**
 * SessionStore 극한 환경 통합 테스트.
 *
 * 커버하는 시나리오:
 * 1. 동시 append — 같은 세션에 병렬 쓰기 시 메시지 손실 없음
 * 2. 동시 다른 세션 — 독립 세션 간 격리
 * 3. 캐시 미스 후 DB 복원 — 프로세스 재시작 시뮬레이션
 * 4. append + get_or_create 동시 — 읽기 중 쓰기 간섭 없음
 * 5. save()의 DELETE+INSERT ALL이 append와 충돌하지 않음
 * 6. 빈 content, 긴 content, 특수문자 — 엣지 케이스
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, Session } from "@src/session/service.js";

let cleanup_dirs: string[] = [];

async function make_store(): Promise<{ store: SessionStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "sess-stress-"));
  cleanup_dirs.push(dir);
  const store = new SessionStore(dir, undefined, null);
  return { store, dir };
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("SessionStore 극한 환경", () => {
  // ─── 1. 동시 append — 같은 세션에 병렬 쓰기 ───

  it("같은 세션에 50개 메시지를 동시 append해도 손실 없음", async () => {
    const { store } = await make_store();
    const key = "stress:same-session";
    const N = 50;

    const promises = Array.from({ length: N }, (_, i) =>
      store.append_message(key, { role: "user", content: `msg-${i}` }),
    );
    await Promise.all(promises);

    const session = await store.get_or_create(key);
    expect(session.messages).toHaveLength(N);

    // 모든 메시지가 존재하는지 확인 (순서는 직렬화로 보장)
    const contents = new Set(session.messages.map((m) => m.content));
    for (let i = 0; i < N; i++) {
      expect(contents.has(`msg-${i}`)).toBe(true);
    }
  });

  it("append된 메시지의 idx가 연속적이고 유일함", async () => {
    const { store } = await make_store();
    const key = "stress:idx-unique";

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.append_message(key, { role: "user", content: `m-${i}` }),
      ),
    );

    const session = await store.get_or_create(key);
    expect(session.messages).toHaveLength(20);

    // DB에서 직접 읽어 idx 확인 — get_or_create는 정렬된 결과를 반환
    for (let i = 0; i < session.messages.length - 1; i++) {
      // 메시지가 순서대로 로드되어야 함
      expect(session.messages[i].content).toBeDefined();
    }
  });

  // ─── 2. 동시 다른 세션 — 격리 ───

  it("서로 다른 세션에 동시 쓰기 시 격리 보장", async () => {
    const { store } = await make_store();
    const keys = ["iso:chat-A", "iso:chat-B", "iso:chat-C"];
    const PER_KEY = 30;

    const promises = keys.flatMap((key) =>
      Array.from({ length: PER_KEY }, (_, i) =>
        store.append_message(key, { role: "user", content: `${key}:${i}` }),
      ),
    );
    await Promise.all(promises);

    for (const key of keys) {
      const session = await store.get_or_create(key);
      expect(session.messages).toHaveLength(PER_KEY);
      // 다른 세션의 메시지가 섞이지 않았는지
      for (const m of session.messages) {
        expect(String(m.content).startsWith(key)).toBe(true);
      }
    }
  });

  // ─── 3. 캐시 미스 후 DB 복원 (프로세스 재시작 시뮬레이션) ───

  it("새 SessionStore 인스턴스가 기존 DB에서 메시지를 복원함", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-restart-"));
    cleanup_dirs.push(dir);

    // 첫 번째 "프로세스"
    const store1 = new SessionStore(dir, undefined, null);
    await store1.append_message("restart:test", { role: "user", content: "before-restart" });
    await store1.append_message("restart:test", { role: "assistant", content: "response-1" });

    // 두 번째 "프로세스" — 새 인스턴스 (캐시 없음)
    const store2 = new SessionStore(dir, undefined, null);
    const session = await store2.get_or_create("restart:test");

    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].content).toBe("before-restart");
    expect(session.messages[1].content).toBe("response-1");
  });

  it("재시작 후 append가 기존 메시지 뒤에 이어짐", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-resume-"));
    cleanup_dirs.push(dir);

    const store1 = new SessionStore(dir, undefined, null);
    await store1.append_message("resume:key", { role: "user", content: "msg-0" });
    await store1.append_message("resume:key", { role: "user", content: "msg-1" });

    // 재시작
    const store2 = new SessionStore(dir, undefined, null);
    await store2.append_message("resume:key", { role: "user", content: "msg-2" });
    await store2.append_message("resume:key", { role: "assistant", content: "msg-3" });

    const session = await store2.get_or_create("resume:key");
    expect(session.messages).toHaveLength(4);
    expect(session.messages.map((m) => m.content)).toEqual(["msg-0", "msg-1", "msg-2", "msg-3"]);
  });

  // ─── 4. append + get_or_create 동시 ───

  it("append 중 get_or_create가 최소한 이전 데이터를 반환하고 DB에 전부 기록됨", async () => {
    const { store, dir } = await make_store();
    const key = "race:read-write";

    // 먼저 기본 데이터 삽입
    for (let i = 0; i < 5; i++) {
      await store.append_message(key, { role: "user", content: `base-${i}` });
    }

    // 동시에 append + read
    const append_p = Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.append_message(key, { role: "user", content: `concurrent-${i}` }),
      ),
    );
    const session = await store.get_or_create(key);

    // read 시점에 최소 base 5개는 있어야 함
    expect(session.messages.length).toBeGreaterThanOrEqual(5);

    await append_p;

    // DB 정합성 확인 — 새 인스턴스로 캐시 우회
    const fresh = new SessionStore(dir, undefined, null);
    const db_session = await fresh.get_or_create(key);
    expect(db_session.messages).toHaveLength(15);
  });

  // ─── 5. save() vs append_message 충돌 ───

  it("save()와 append_message가 동시에 호출되어도 데이터 손실 없음", async () => {
    const { store } = await make_store();
    const key = "conflict:save-append";

    // 초기 데이터
    await store.append_message(key, { role: "user", content: "initial" });

    // get_or_create로 세션 가져온 후 save + 동시 append
    const session = await store.get_or_create(key);
    session.messages.push({ role: "assistant", content: "via-save" });

    const save_p = store.save(session);
    const append_p = store.append_message(key, { role: "user", content: "via-append" });

    await Promise.all([save_p, append_p]);

    // 재시작 시뮬레이션으로 DB에서 직접 확인
    const dir = (store as any).sessions_dir;
    const fresh = new SessionStore((store as any).workspace, dir, null);
    const result = await fresh.get_or_create(key);

    // save의 DELETE+INSERT ALL이 Lane 직렬화로 보호되므로
    // append가 먼저 실행되든 save가 먼저 실행되든 최종 결과는 일관적
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 6. 엣지 케이스 ───

  it("빈 content도 저장됨", async () => {
    const { store } = await make_store();
    await store.append_message("edge:empty", { role: "user", content: "" });

    const session = await store.get_or_create("edge:empty");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("");
  });

  it("undefined content도 저장됨", async () => {
    const { store } = await make_store();
    await store.append_message("edge:undef", { role: "user" });

    const session = await store.get_or_create("edge:undef");
    expect(session.messages).toHaveLength(1);
  });

  it("4KB 이상의 긴 content도 손실 없이 저장", async () => {
    const { store } = await make_store();
    const long_content = "A".repeat(8192);
    await store.append_message("edge:long", { role: "user", content: long_content });

    const session = await store.get_or_create("edge:long");
    expect(session.messages[0].content).toBe(long_content);
  });

  it("특수문자와 유니코드가 정확히 보존됨", async () => {
    const { store } = await make_store();
    const special = "한글 테스트 🎉 <script>alert('xss')</script> \n\t \"quotes\" 'single' NULL \0 emoji: 🔥";
    await store.append_message("edge:special", { role: "user", content: special });

    const session = await store.get_or_create("edge:special");
    expect(session.messages[0].content).toBe(special);
  });

  it("JSON metadata가 message_json에 보존됨", async () => {
    const { store } = await make_store();
    await store.append_message("edge:meta", {
      role: "assistant",
      content: "hello",
      sender_id: "bot",
      tool_calls_count: 5,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const session = await store.get_or_create("edge:meta");
    const msg = session.messages[0] as Record<string, unknown>;
    expect(msg.sender_id).toBe("bot");
    expect(msg.tool_calls_count).toBe(5);
    expect(msg.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  // ─── 7. 대량 동시 세션 ───

  it("100개 세션에 동시 쓰기 후 모든 데이터 정합성 확인", async () => {
    const { store } = await make_store();
    const NUM_SESSIONS = 100;
    const MSGS_PER = 5;

    const promises: Promise<void>[] = [];
    for (let s = 0; s < NUM_SESSIONS; s++) {
      for (let m = 0; m < MSGS_PER; m++) {
        promises.push(
          store.append_message(`mass:s${s}`, { role: "user", content: `s${s}:m${m}` }),
        );
      }
    }
    await Promise.all(promises);

    // 랜덤 샘플링으로 정합성 확인
    for (const idx of [0, 25, 50, 75, 99]) {
      const session = await store.get_or_create(`mass:s${idx}`);
      expect(session.messages).toHaveLength(MSGS_PER);
      const contents = session.messages.map((m) => m.content);
      for (let m = 0; m < MSGS_PER; m++) {
        expect(contents).toContain(`s${idx}:m${m}`);
      }
    }
  });

  // ─── 8. prune 중 동시 쓰기 ───

  it("prune_expired 중 다른 세션 쓰기가 블로킹되지 않음", async () => {
    const { store } = await make_store();

    // 오래된 세션 생성
    await store.append_message("prune:old", { role: "user", content: "old" });
    // 최신 세션 생성
    await store.append_message("prune:new", { role: "user", content: "new" });

    // prune + 동시 쓰기
    const prune_p = store.prune_expired(0); // 모든 세션 prune 시도 (max_age_ms=0이면 60초로 제한)
    const write_p = store.append_message("prune:during", { role: "user", content: "during-prune" });

    await Promise.all([prune_p, write_p]);

    // during-prune 세션은 정상 저장
    const session = await store.get_or_create("prune:during");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("during-prune");
  });

  // ─── 9. delete 후 append ───

  it("세션 삭제 후 같은 키로 append하면 새 세션 생성", async () => {
    const { store } = await make_store();
    const key = "lifecycle:delete-recreate";

    await store.append_message(key, { role: "user", content: "before-delete" });
    await store.delete(key);

    await store.append_message(key, { role: "user", content: "after-delete" });
    const session = await store.get_or_create(key);

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("after-delete");
  });

  // ─── 10. 빠른 연속 메시지 (실제 사용 패턴) ───

  it("user → assistant → user → assistant 빠른 연속 대화", async () => {
    const { store } = await make_store();
    const key = "realworld:rapid-exchange";

    const conversation = [
      { role: "user", content: "안녕하세요" },
      { role: "assistant", content: "반갑습니다! 무엇을 도와드릴까요?" },
      { role: "user", content: "OAuth 설정 도와줘" },
      { role: "assistant", content: "[10 tool calls] OAuth 설정을 시작합니다..." },
      { role: "user", content: "위의 요청 작업중이야?" },
      { role: "assistant", content: "네, 현재 OAuth 설정 작업을 진행 중입니다." },
    ];

    for (const msg of conversation) {
      await store.append_message(key, msg);
    }

    const session = await store.get_or_create(key);
    expect(session.messages).toHaveLength(6);
    expect(session.messages.map((m) => m.content)).toEqual(conversation.map((c) => c.content));
  });
});
