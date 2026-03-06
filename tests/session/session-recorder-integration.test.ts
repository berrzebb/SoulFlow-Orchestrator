/**
 * SessionRecorder 통합 테스트 — 실제 SQLite SessionStore 사용.
 *
 * Mock이 잡지 못하는 시나리오:
 * 1. record → 프로세스 재시작 → get_history로 복원
 * 2. 동시 record_user/record_assistant가 DB에 전부 기록
 * 3. 같은 채팅 다른 스레드 세션 격리
 * 4. sanitize가 DB 레벨까지 적용
 * 5. get_history의 max_messages/max_age_ms가 실제 데이터에서 동작
 * 6. get_last_assistant_content가 실제 DB에서 동작
 * 7. 빠른 연속 대화 → 재시작 → 히스토리 정합성
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@src/session/service.js";
import { SessionRecorder } from "@src/channels/session-recorder.js";
import type { InboundMessage } from "@src/bus/types.js";

let cleanup_dirs: string[] = [];

function make_logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function (this: unknown) { return this; }),
  } as any;
}

function make_message(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    provider: "slack",
    channel: "slack",
    sender_id: "user1",
    chat_id: "C123",
    content: "hello world",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

async function make_recorder(opts?: { sanitize?: (t: string) => string; dir?: string }) {
  const dir = opts?.dir ?? await mkdtemp(join(tmpdir(), "rec-integ-"));
  cleanup_dirs.push(dir);
  const store = new SessionStore(dir, undefined, null);
  const daily_lines: string[] = [];
  const recorder = new SessionRecorder({
    sessions: store,
    daily_memory: { append_daily_memory: async (line) => { daily_lines.push(line); } },
    sanitize_for_storage: opts?.sanitize ?? ((t) => t),
    logger: make_logger(),
  });
  return { recorder, store, dir, daily_lines };
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("SessionRecorder 통합 (실제 SQLite)", () => {
  // ─── 1. record → 재시작 → get_history 복원 ───

  it("record 후 프로세스 재시작해도 get_history가 모든 메시지를 반환", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-restart-"));
    cleanup_dirs.push(dir);

    // 첫 번째 프로세스
    const { recorder: rec1 } = await make_recorder({ dir });
    await rec1.record_user("slack", make_message({ content: "질문입니다" }), "bot");
    await rec1.record_assistant(
      "slack", make_message({ content: "질문입니다" }), "bot", "답변입니다",
    );
    await rec1.record_user("slack", make_message({ content: "추가 질문" }), "bot");

    // 두 번째 프로세스 — 새 인스턴스
    const { recorder: rec2 } = await make_recorder({ dir });
    const history = await rec2.get_history("slack", "C123", "bot", undefined, 100, 0);

    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ role: "user", content: "질문입니다" });
    expect(history[1]).toEqual({ role: "assistant", content: "답변입니다" });
    expect(history[2]).toEqual({ role: "user", content: "추가 질문" });
  });

  // ─── 2. 동시 record — 병렬 쓰기 무손실 ───

  it("10개 메시지를 동시 record해도 DB에 전부 기록", async () => {
    const { recorder, store } = await make_recorder();
    const msg = make_message();

    const promises = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? recorder.record_user("slack", make_message({ content: `user-${i}` }), "bot")
        : recorder.record_assistant("slack", msg, "bot", `assistant-${i}`),
    );
    await Promise.all(promises);

    const history = await recorder.get_history("slack", "C123", "bot", undefined, 100, 0);
    expect(history).toHaveLength(10);
  });

  // ─── 3. 스레드 격리 ───

  it("같은 채팅의 main과 thread가 독립 세션으로 격리", async () => {
    const { recorder } = await make_recorder();

    // main 채널 메시지
    await recorder.record_user("slack", make_message({ content: "main-msg" }), "bot");
    await recorder.record_assistant("slack", make_message(), "bot", "main-reply");

    // 스레드 메시지
    const thread_msg = make_message({ content: "thread-msg", thread_id: "T456" });
    await recorder.record_user("slack", thread_msg, "bot");
    await recorder.record_assistant("slack", thread_msg, "bot", "thread-reply");

    // main 히스토리
    const main_history = await recorder.get_history("slack", "C123", "bot", undefined, 100, 0);
    expect(main_history).toHaveLength(2);
    expect(main_history[0].content).toBe("main-msg");

    // thread 히스토리
    const thread_history = await recorder.get_history("slack", "C123", "bot", "T456", 100, 0);
    expect(thread_history).toHaveLength(2);
    expect(thread_history[0].content).toBe("thread-msg");
  });

  it("다른 스레드 간에도 격리", async () => {
    const { recorder } = await make_recorder();

    await recorder.record_user("slack", make_message({ content: "t1", thread_id: "T1" }), "bot");
    await recorder.record_user("slack", make_message({ content: "t2", thread_id: "T2" }), "bot");

    const h1 = await recorder.get_history("slack", "C123", "bot", "T1", 100, 0);
    const h2 = await recorder.get_history("slack", "C123", "bot", "T2", 100, 0);

    expect(h1).toHaveLength(1);
    expect(h1[0].content).toBe("t1");
    expect(h2).toHaveLength(1);
    expect(h2[0].content).toBe("t2");
  });

  // ─── 4. sanitize가 DB 레벨까지 적용 ───

  it("sanitize 함수가 DB에 저장되는 content에 적용", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-sanitize-"));
    cleanup_dirs.push(dir);

    // secret을 [REDACTED]로 치환하는 sanitizer
    const sanitize = (t: string) => t.replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]");
    const { recorder } = await make_recorder({ sanitize, dir });

    await recorder.record_user(
      "slack",
      make_message({ content: "API 키는 sk-abc123def456 입니다" }),
      "bot",
    );

    // 재시작 후에도 sanitize된 값이 DB에 저장되어 있어야 함
    const { recorder: rec2 } = await make_recorder({ dir });
    const history = await rec2.get_history("slack", "C123", "bot", undefined, 100, 0);

    expect(history[0].content).toBe("API 키는 [REDACTED] 입니다");
    expect(history[0].content).not.toContain("sk-abc123");
  });

  // ─── 5. get_history max_messages 실제 동작 ───

  it("get_history가 max_messages로 최근 N개만 반환", async () => {
    const { recorder } = await make_recorder();

    for (let i = 0; i < 20; i++) {
      await recorder.record_user("slack", make_message({ content: `msg-${i}` }), "bot");
    }

    const history = await recorder.get_history("slack", "C123", "bot", undefined, 5, 0);
    expect(history).toHaveLength(5);
    expect(history[0].content).toBe("msg-15");
    expect(history[4].content).toBe("msg-19");
  });

  it("get_history가 max_age_ms로 오래된 메시지 필터링", async () => {
    const { recorder, store } = await make_recorder();

    // 1시간 전 메시지 직접 삽입
    const old_ts = new Date(Date.now() - 3600_000).toISOString();
    await store.append_message("slack:C123:bot:main", {
      role: "user", content: "old-msg", timestamp: old_ts,
    });

    // 현재 메시지
    await recorder.record_user("slack", make_message({ content: "recent-msg" }), "bot");

    // 30분 이내만 조회
    const history = await recorder.get_history("slack", "C123", "bot", undefined, 100, 1800_000);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("recent-msg");
  });

  // ─── 6. get_last_assistant_content 실제 동작 ───

  it("get_last_assistant_content가 마지막 assistant 메시지를 반환", async () => {
    const { recorder } = await make_recorder();

    await recorder.record_user("slack", make_message(), "bot");
    await recorder.record_assistant("slack", make_message(), "bot", "첫 번째 답변");
    await recorder.record_user("slack", make_message(), "bot");
    await recorder.record_assistant("slack", make_message(), "bot", "두 번째 답변");
    await recorder.record_user("slack", make_message(), "bot");

    const last = await recorder.get_last_assistant_content("slack", "C123", "bot");
    expect(last).toBe("두 번째 답변");
  });

  it("get_last_assistant_content — 재시작 후에도 동작", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-last-"));
    cleanup_dirs.push(dir);

    const { recorder: rec1 } = await make_recorder({ dir });
    await rec1.record_assistant("slack", make_message(), "bot", "이전 세션 답변");

    // 재시작
    const { recorder: rec2 } = await make_recorder({ dir });
    const last = await rec2.get_last_assistant_content("slack", "C123", "bot");
    expect(last).toBe("이전 세션 답변");
  });

  // ─── 7. 실제 사용 시나리오: 빠른 연속 대화 → 재시작 → 복원 ───

  it("Slack 실제 대화 흐름 시뮬레이션", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-slack-sim-"));
    cleanup_dirs.push(dir);

    const { recorder: rec1 } = await make_recorder({ dir });

    // 1. main 채널에서 요청
    await rec1.record_user("slack", make_message({ content: "OAuth 설정 해줘" }), "assistant");
    await rec1.record_assistant("slack", make_message(), "assistant", "3단계로 진행하겠습니다");

    // 2. 스레드에서 추가 지시
    const thread_msg = make_message({ thread_id: "1772746200.174599" });
    await rec1.record_user(
      "slack",
      { ...thread_msg, content: "그래 정확해, oauth relay 스크립트 먼저 만들어줘" },
      "assistant",
    );
    await rec1.record_assistant(
      "slack", thread_msg, "assistant",
      "[10 tool calls] OAuth relay 스크립트를 생성합니다...",
      { tool_calls_count: 10, run_id: "run-abc123" },
    );

    // 3. watch 모드로 프로세스 재시작 (코드 수정)
    const { recorder: rec2 } = await make_recorder({ dir });

    // 4. 스레드에서 "작업 중이야?" 질문
    await rec2.record_user(
      "slack",
      { ...thread_msg, content: "위의 요청 작업중이야?" },
      "assistant",
    );

    // 5. 재시작 후에도 스레드 히스토리가 온전해야 함
    const thread_history = await rec2.get_history(
      "slack", "C123", "assistant", "1772746200.174599", 100, 0,
    );

    expect(thread_history).toHaveLength(3);
    expect(thread_history[0].content).toContain("oauth relay");
    expect(thread_history[1].content).toContain("tool calls");
    expect(thread_history[2].content).toContain("작업중");

    // main 히스토리도 살아있어야 함
    const main_history = await rec2.get_history("slack", "C123", "assistant", undefined, 100, 0);
    expect(main_history).toHaveLength(2);
    expect(main_history[0].content).toBe("OAuth 설정 해줘");
  });

  // ─── 8. 동시 user + assistant record 경합 ───

  it("같은 스레드에 user와 assistant가 거의 동시에 기록되어도 순서 보존", async () => {
    const { recorder, dir } = await make_recorder();
    const thread_msg = make_message({ thread_id: "T789" });

    // 빠른 연속 기록 (await 없이 동시 발사)
    const p1 = recorder.record_user("slack", { ...thread_msg, content: "질문1" }, "bot");
    const p2 = recorder.record_assistant("slack", thread_msg, "bot", "답변1");
    const p3 = recorder.record_user("slack", { ...thread_msg, content: "질문2" }, "bot");
    const p4 = recorder.record_assistant("slack", thread_msg, "bot", "답변2");
    await Promise.all([p1, p2, p3, p4]);

    // DB에서 직접 확인 (캐시 우회)
    const fresh = new SessionStore(dir, undefined, null);
    const session = await fresh.get_or_create("slack:C123:bot:T789");
    expect(session.messages).toHaveLength(4);

    // role 순서 확인 — Lane 직렬화로 FIFO 보장
    const roles = session.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  // ─── 9. assistant metadata가 DB에 보존 ───

  it("record_assistant의 metadata가 재시작 후에도 DB에 보존", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-meta-"));
    cleanup_dirs.push(dir);

    const { recorder: rec1, store: store1 } = await make_recorder({ dir });
    await rec1.record_assistant("slack", make_message(), "bot", "응답 내용", {
      tool_calls_count: 5,
      run_id: "run-xyz",
      usage: { input_tokens: 1000, output_tokens: 500 },
      stream_full_content: "전체 스트리밍 내용...",
    });

    // 재시작
    const store2 = new SessionStore(dir, undefined, null);
    const session = await store2.get_or_create("slack:C123:bot:main");
    const msg = session.messages[0] as Record<string, unknown>;

    expect(msg.tool_calls_count).toBe(5);
    expect(msg.run_id).toBe("run-xyz");
    expect(msg.usage).toEqual({ input_tokens: 1000, output_tokens: 500 });
    expect(msg.stream_full_content).toBe("전체 스트리밍 내용...");
  });

  // ─── 10. daily_memory 동시 기록 ───

  it("record 시 daily_memory에도 올바른 형식으로 기록", async () => {
    const { recorder, daily_lines } = await make_recorder();

    await recorder.record_user(
      "slack", make_message({ sender_id: "U_HUMAN", content: "안녕하세요" }), "bot",
    );
    await recorder.record_assistant("slack", make_message(), "bot", "반갑습니다");

    expect(daily_lines).toHaveLength(2);
    expect(daily_lines[0]).toContain("USER(U_HUMAN)");
    expect(daily_lines[0]).toContain("안녕하세요");
    expect(daily_lines[1]).toContain("ASSISTANT(bot)");
    expect(daily_lines[1]).toContain("반갑습니다");
  });

  // ─── 11. 다중 프로바이더 격리 ───

  it("같은 chat_id라도 다른 provider면 독립 세션", async () => {
    const { recorder } = await make_recorder();

    await recorder.record_user("slack", make_message({ content: "slack-msg" }), "bot");
    await recorder.record_user(
      "telegram",
      make_message({ provider: "telegram", content: "telegram-msg" }),
      "bot",
    );

    const slack_h = await recorder.get_history("slack", "C123", "bot", undefined, 100, 0);
    const tg_h = await recorder.get_history("telegram", "C123", "bot", undefined, 100, 0);

    expect(slack_h).toHaveLength(1);
    expect(slack_h[0].content).toBe("slack-msg");
    expect(tg_h).toHaveLength(1);
    expect(tg_h[0].content).toBe("telegram-msg");
  });

  // ─── 12. 빈 content 필터링 ───

  it("get_history가 빈 content 메시지를 필터링", async () => {
    const { recorder } = await make_recorder();

    await recorder.record_user("slack", make_message({ content: "" }), "bot");
    await recorder.record_user("slack", make_message({ content: "실제 내용" }), "bot");
    await recorder.record_user("slack", make_message({ content: "" }), "bot");

    const history = await recorder.get_history("slack", "C123", "bot", undefined, 100, 0);
    // get_history는 .filter(r => Boolean(r.content))로 빈 content 제거
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("실제 내용");
  });

  // ─── 13. 대량 히스토리 재시작 복원 ───

  it("100개 메시지 기록 후 재시작해도 전부 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-bulk-"));
    cleanup_dirs.push(dir);

    const { recorder: rec1 } = await make_recorder({ dir });
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        await rec1.record_user("slack", make_message({ content: `user-${i}` }), "bot");
      } else {
        await rec1.record_assistant("slack", make_message(), "bot", `assistant-${i}`);
      }
    }

    // 재시작
    const { recorder: rec2 } = await make_recorder({ dir });
    const history = await rec2.get_history("slack", "C123", "bot", undefined, 100, 0);
    expect(history).toHaveLength(100);
    expect(history[0].content).toBe("user-0");
    expect(history[99].content).toBe("assistant-99");
  });
});
