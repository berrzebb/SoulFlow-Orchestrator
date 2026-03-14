/**
 * E4: MemoryIngestionReducer 테스트.
 *
 * - plain 텍스트: 한도(display_text 2×) 이하 → 원본 유지
 * - plain overflow → display_text(2×) 기준으로 압축 (관대한 보존)
 * - noisy kind (shell/log 등): storage_text(1.5×) 기준으로 압축
 * - 빈 입력 → 빈 출력
 * - hint로 kind 강제: bash hint → shell kind → storage_text 경로
 * - turn-memory-recorder: reducer 제공/미제공 양쪽 경로 검증
 */

import { describe, it, expect, vi } from "vitest";
import { create_memory_ingestion_reducer } from "@src/orchestration/memory-ingestion-reducer.js";
import { record_turn_to_daily } from "@src/orchestration/turn-memory-recorder.js";

// ── plain 텍스트 ────────────────────────────────────────────────────

describe("MemoryIngestionReducer — plain 텍스트 보존", () => {
  const reducer = create_memory_ingestion_reducer(100);

  it("display_text 한도(2×=200) 이하 → 원본 반환", () => {
    const text = "hello world";
    expect(reducer.reduce(text)).toBe(text);
  });

  it("plain overflow(> 2×=200) → display_text 한도 내로 압축", () => {
    // max=100 → display_text 한도 = 200
    const long = "a".repeat(300);
    const result = reducer.reduce(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.length).toBeLessThan(long.length);
  });

  it("plain은 storage_text(150) 한도보다 더 많이 보존 가능 (관대한 보존)", () => {
    // 길이 160짜리 plain 텍스트: storage_text(150)로는 잘리지만 display_text(200)는 허용
    const text = "x".repeat(160);
    const result = reducer.reduce(text);
    // display_text 경로 → 160 ≤ 200 이므로 잘리지 않음
    expect(result).toBe(text);
  });
});

// ── noisy kind ─────────────────────────────────────────────────────

describe("MemoryIngestionReducer — noisy kind (storage_text 1.5×)", () => {
  const reducer = create_memory_ingestion_reducer(100);

  it("shell hint → storage_text(1.5×=150) 기준, 150자 이하", () => {
    const long = "$ npm install\n" + "output ".repeat(50) + "\nError: EACCES";
    const result = reducer.reduce(long, "bash");
    expect(result.length).toBeLessThanOrEqual(150);
  });

  it("log 패턴 → storage_text(1.5×=150) 기준으로 압축", () => {
    const log = "[INFO] x\n[DEBUG] y\n[ERROR] z\n[WARN] w\n".repeat(20);
    const result = reducer.reduce(log);
    expect(result.length).toBeLessThanOrEqual(150);
  });

  it("shell은 동일 텍스트에서 plain보다 더 많이 압축", () => {
    // bash hint → shell kind (storage_text 1.5×)
    // 힌트 없음 → plain kind (display_text 2×)
    const text = "a ".repeat(200);
    const plain_result = reducer.reduce(text);
    const shell_result = reducer.reduce(text, "bash");
    // shell이 plain보다 짧거나 같아야 함 (더 압축)
    expect(shell_result.length).toBeLessThanOrEqual(plain_result.length);
  });
});

// ── 경계값 ─────────────────────────────────────────────────────────

describe("MemoryIngestionReducer — 경계값", () => {
  const reducer = create_memory_ingestion_reducer(100);

  it("빈 문자열 → 빈 문자열 반환", () => {
    expect(reducer.reduce("")).toBe("");
  });

  it("hint 미제공 → 기본값(빈 문자열 hint) 처리 정상", () => {
    expect(() => reducer.reduce("hello")).not.toThrow();
  });

  it("max_prompt_chars 기본값(1200) 사용 시 1200자 이하 plain → 원본 반환", () => {
    const default_reducer = create_memory_ingestion_reducer();
    const text = "word ".repeat(200); // 1000자
    expect(default_reducer.reduce(text)).toBe(text);
  });
});

// ── turn-memory-recorder 하위 호환 ────────────────────────────────

describe("record_turn_to_daily — reducer 하위 호환", () => {
  function make_req(content: string) {
    return {
      message: { content, chat_id: "ch1" },
      alias: "bot",
      provider: "slack",
      media_inputs: [],
      session_history: [],
    };
  }

  function make_result(reply: string) {
    return {
      reply,
      error: undefined,
      suppress_reply: false,
      builtin_command: undefined,
    };
  }

  it("reducer 미제공 → MAX_CONTENT_CHARS(600) truncation 경로 사용", async () => {
    const captured: string[] = [];
    const memory = {
      append_daily: vi.fn(async (s: string) => {
        captured.push(s);
      }),
    };

    record_turn_to_daily(
      make_req("user message") as any,
      make_result("B".repeat(700)) as any,
      memory as any,
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(memory.append_daily).toHaveBeenCalledOnce();
    const bot_section = captured[0]!.split("**Bot:**")[1] ?? "";
    // 700자 중 601자 + "…" truncation 적용됨
    expect(bot_section.length).toBeLessThan(710); // 700자 raw보다 짧아야 함
    expect(bot_section).toContain("…");
  });

  it("reducer 제공 → reducer.reduce() 호출 및 결과 반영", async () => {
    const captured: string[] = [];
    const memory = {
      append_daily: vi.fn(async (s: string) => {
        captured.push(s);
      }),
    };
    const reducer = { reduce: vi.fn(() => "REDUCED_RESULT") };

    record_turn_to_daily(
      make_req("user question") as any,
      make_result("original long bot reply") as any,
      memory as any,
      reducer as any,
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(reducer.reduce).toHaveBeenCalledWith("original long bot reply");
    expect(captured[0]).toContain("REDUCED_RESULT");
  });

  it("error 결과 → 기록 생략", async () => {
    const memory = { append_daily: vi.fn() };
    record_turn_to_daily(
      make_req("msg") as any,
      { reply: "reply", error: new Error("fail"), suppress_reply: false } as any,
      memory as any,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(memory.append_daily).not.toHaveBeenCalled();
  });

  it("빈 reply → 기록 생략", async () => {
    const memory = { append_daily: vi.fn() };
    record_turn_to_daily(
      make_req("msg") as any,
      make_result("") as any,
      memory as any,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(memory.append_daily).not.toHaveBeenCalled();
  });
});
