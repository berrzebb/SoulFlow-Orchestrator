/**
 * 미커버 분기 보충 (edge-cases-4):
 *
 * - output-sanitizer.ts L152: strip_persona_leak_blocks("") → ""
 * - output-sanitizer.ts L246: normalize_regex_cache 200+ 엔트리 → clear()
 * - msgpack.ts L112: string 길이 > 65535 → 4바이트 헤더 (0xdb)
 * - msgpack.ts L120: 배열 길이 > 65535 → 4바이트 헤더 (0xdd)
 * - queue.ts L44: MAX_QUEUES 도달 → 새 큐 생성 금지
 * - cron-shell.ts L67: MAX_ENTRIES 도달 → 새 잡 등록 금지
 * - cron-shell.ts L73: setInterval 콜백 실행 (fake timers)
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  strip_persona_leak_blocks,
  normalize_agent_reply,
} from "@src/channels/output-sanitizer.js";
import { MsgpackTool } from "@src/agent/tools/msgpack.js";
import { QueueTool } from "@src/agent/tools/queue.js";
import { CronShellTool } from "@src/agent/tools/cron-shell.js";

// ── output-sanitizer.ts L152: strip_persona_leak_blocks("") → "" ─────────────

describe("output-sanitizer — L152: strip_persona_leak_blocks 빈 입력 → ''", () => {
  it("빈 문자열 → L152: if (!raw) return '' 실행", () => {
    expect(strip_persona_leak_blocks("")).toBe("");
  });

  it("null/undefined 등가 falsy → L152 return ''", () => {
    // strip_persona_leak_blocks(raw: string) — raw="" 는 falsy
    expect(strip_persona_leak_blocks("" as any)).toBe("");
  });
});

// ── output-sanitizer.ts L246: normalize_regex_cache 200+ 엔트리 → .clear() ──

describe("output-sanitizer — L246: 200+ 캐시 엔트리 → clear() 실행", () => {
  it("200+번 서로 다른 alias+sender_id 조합으로 호출 → 캐시 clear() 실행 (L246)", () => {
    // MAX_REGEX_CACHE = 200이므로 201번째 새 조합 시 clear() 실행
    for (let i = 0; i < 201; i++) {
      const alias = `alias_${i}`;
      const sender = `sender_${i}`;
      const result = normalize_agent_reply("hello world", alias, sender);
      // 예외 없이 실행되면 성공
      expect(result === null || typeof result === "string").toBe(true);
    }
    // 201번째 호출 시 캐시가 clear되어 새 엔트리로 재생성됨 (L246)
  });
});

// ── msgpack.ts L112: string 길이 > 65535 → 0xdb 헤더 ───────────────────────

describe("MsgpackTool — L112: 65536자 문자열 → 4바이트 str 헤더 (0xdb)", () => {
  const tool = new MsgpackTool();

  it("65536자 문자열 encode → L112 else 분기 (len > 0xffff)", async () => {
    // encode_value(string) L112: else { out.push(0xdb, ...) } — len > 65535
    const longStr = "a".repeat(65536);
    const data = JSON.stringify(longStr); // JSON string 표현
    const r = JSON.parse(await tool.execute({ action: "encode", data }));
    expect(r.byte_length).toBeGreaterThan(65536);
    // 0xdb 헤더 확인: 첫 바이트
    const hex = r.hex;
    expect(hex.startsWith("db")).toBe(true);
  });
});

// ── msgpack.ts L120: 배열 길이 > 65535 → 0xdd 헤더 ─────────────────────────

describe("MsgpackTool — L120: 65536개 배열 → 4바이트 array 헤더 (0xdd)", () => {
  const tool = new MsgpackTool();

  it("65536개 배열 encode → L120 else 분기 (len > 0xffff)", async () => {
    // encode_value(array) L120: else { out.push(0xdd, ...) } — len > 65535
    const bigArray = new Array(65536).fill(0);
    const data = JSON.stringify(bigArray);
    const r = JSON.parse(await tool.execute({ action: "encode", data }));
    expect(r.byte_length).toBeGreaterThan(65536);
    // 0xdd 헤더 확인: 첫 바이트
    expect(r.hex.startsWith("dd")).toBe(true);
  });
});

// ── queue.ts L44: MAX_QUEUES 도달 → 새 큐 생성 금지 ────────────────────────

describe("QueueTool — L44: MAX_QUEUES(50) 도달 → 51번째 새 큐 에러", () => {
  it("50개 큐 생성 후 51번째 새 큐 enqueue → L44 error 반환", async () => {
    const tool = new QueueTool();

    // 50개 큐 생성 (각 큐에 1개 아이템 enqueue) - queue 파라미터 사용
    for (let i = 0; i < 50; i++) {
      const result = await tool.execute({
        operation: "enqueue",
        queue: `queue_${i}`,
        value: `item_${i}`,
      });
      expect(result).toContain("Enqueued");
    }

    // 51번째 새 큐 생성 시도 → L44: if (this.queues.size >= MAX_QUEUES) return error
    const r = await tool.execute({
      operation: "enqueue",
      queue: "queue_overflow",
      value: "overflow_item",
    });
    expect(r).toContain("Error");
    expect(r).toContain("max");
  });
});

// ── cron-shell.ts L67: MAX_ENTRIES(50) 도달 → 51번째 잡 등록 금지 ────────────

describe("CronShellTool — L67: MAX_ENTRIES(50) 도달 → 새 잡 등록 에러", () => {
  it("50개 잡 등록 후 51번째 새 잡 → L67 error 반환", async () => {
    const tool = new CronShellTool({ workspace: process.cwd() });

    // 50개 잡 등록 (직접 entries Map에 주입하여 빠르게 채움)
    const entries = (tool as any).entries as Map<string, unknown>;
    const timers = (tool as any).timers as Map<string, unknown>;
    for (let i = 0; i < 50; i++) {
      const id = `pre-job-${i}`;
      entries.set(id, { id, expression: "*/1 * * * *", command: "echo", run_count: 0, enabled: true });
      timers.set(id, null); // timer placeholder
    }

    // 51번째 새 잡 등록 시도 → L67: if (entries.size >= MAX_ENTRIES && !entries.has(id))
    const r = await tool.execute({
      operation: "register",
      id: "new-job-overflow",
      expression: "*/5 * * * *",
      command: "echo overflow",
    });
    expect(r).toContain("Error");
    expect(r).toContain("max");
  });
});

// ── cron-shell.ts L73: setInterval 콜백 실행 (fake timers) ───────────────────

describe("CronShellTool — L73: setInterval 콜백 (fake timers로 실행)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fake timers로 setInterval 콜백 실행 → L73 커버", async () => {
    vi.useFakeTimers();

    const tool = new CronShellTool({ workspace: process.cwd() });

    // execute_job을 spy로 교체 (실제 셸 실행 방지)
    const spy = vi.spyOn(tool as any, "execute_job").mockResolvedValue(undefined);

    // 잡 등록 → this.timers.set(id, setInterval(() => this.execute_job(entry), interval_ms))
    await tool.execute({
      operation: "register",
      id: "fake-timer-job",
      expression: "*/1 * * * *",
      command: "echo test",
    });

    // setInterval 콜백 실행을 위해 60001ms 진행
    await vi.advanceTimersByTimeAsync(60001);

    // L73의 setInterval 콜백 `() => this.execute_job(entry)` 실행 확인
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "fake-timer-job" }));

    // cleanup
    await tool.execute({ operation: "remove", id: "fake-timer-job" });
  });
});
