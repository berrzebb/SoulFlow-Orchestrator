#!/usr/bin/env node
/**
 * Mock NDJSON CLI agent — Claude stream-json 프로토콜을 흉내내는 테스트용 스크립트.
 *
 * stdin으로 AgentInputMessage JSON 을 받으면:
 *   1. {"type":"system","subtype":"init","session_id":"..."} 전송
 *   2. {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}} 전송
 *   3. {"type":"result","result":"..."} 전송
 *
 * 환경변수:
 *   MOCK_DELAY_MS — 응답 지연 (기본 0)
 *   MOCK_ERROR    — 설정 시 error 응답 ("auth", "rate_limit", "crash", "fatal")
 *   MOCK_ECHO     — "true"이면 입력을 그대로 에코
 *   MOCK_TOOL     — "true"이면 tool_use + tool_result 이벤트 포함
 */

import { createInterface } from "node:readline";

const delay_ms = Number(process.env.MOCK_DELAY_MS || "0");
const mock_error = process.env.MOCK_ERROR || "";
const mock_echo = process.env.MOCK_ECHO === "true";
const mock_tool = process.env.MOCK_TOOL === "true";
const session_id = process.argv.find((_, i, arr) => arr[i - 1] === "--session-id") ?? "mock-session";

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// init 이벤트
emit({ type: "system", subtype: "init", session_id });

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(line.trim()); }
  catch { return; }

  if (delay_ms > 0) await sleep(delay_ms);

  if (mock_error) {
    emit({ type: "error", error: `mock_${mock_error}_error`, message: `simulated ${mock_error} error` });
    return;
  }

  const content = String(parsed.content ?? "no content");
  const reply = mock_echo ? content : `response to: ${content}`;

  // assistant 청크
  emit({ type: "assistant", message: { content: [{ type: "text", text: reply }] } });

  // 선택적 tool 이벤트
  if (mock_tool) {
    emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "test_tool", input: { arg: "value" } }] } });
    emit({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "tool output" }] } });
  }

  // complete
  emit({
    type: "result",
    result: reply,
    session_id,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
});

rl.on("close", () => process.exit(0));
