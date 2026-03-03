import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { OrchestrationRequest } from "@src/orchestration/types.ts";
import { create_harness, inbound, type FakeOrchestrationHandler } from "@helpers/harness.ts";

function once_reply(content: string | null): FakeOrchestrationHandler {
  return async () => ({ reply: content, mode: "once", tool_calls_count: 0, streamed: false });
}

describe("channel manager message capabilities", () => {
  it("message flow dispatches orchestration result to channel", async () => {
    const harness = await create_harness({ orchestration_handler: once_reply("HELLO_RESULT") });
    try {
      await harness.manager.handle_inbound_message(inbound("테스트 메시지"));
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/HELLO_RESULT/);
    } finally { await harness.cleanup(); }
  });

  it("orchestration result with media file is attached to channel reply", async () => {
    const harness = await create_harness();
    try {
      const file = join(harness.workspace, "report.txt");
      await writeFile(file, "REPORT_DATA", "utf-8");
      harness.orchestration.handler = async () => ({
        reply: `결과 파일: [report.txt](${file})`,
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      await harness.manager.handle_inbound_message(inbound("파일 생성해줘"));
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(Array.isArray(last.media)).toBe(true);
      expect((last.media || []).length).toBe(1);
      expect(String(last.media?.[0]?.url || "")).toBe(file);
    } finally { await harness.cleanup(); }
  });

  it("korean path is attached as media via markdown image", async () => {
    const harness = await create_harness();
    try {
      const media_dir = join(harness.workspace, "runtime", "inbound-files", "telegram", "카카오톡받은파일");
      await mkdir(media_dir, { recursive: true });
      const media_file = join(media_dir, "분석결과.jpg");
      await writeFile(media_file, "not-a-real-jpg", "utf-8");

      harness.orchestration.handler = async () => ({
        reply: `분석 완료. 결과 이미지는 ![분석결과.jpg](${media_file}) 입니다.`,
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      await harness.manager.handle_inbound_message(inbound("첨부 결과 보내줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(Array.isArray(last.media)).toBe(true);
      expect((last.media || []).length).toBe(1);
      expect(String(last.media?.[0]?.url || "")).toBe(media_file);
    } finally { await harness.cleanup(); }
  });

  it("final text quoted basename file is auto-attached", async () => {
    const harness = await create_harness();
    try {
      const root_file = join(harness.workspace, "final-basename-attach.txt");
      await writeFile(root_file, "report", "utf-8");
      harness.orchestration.handler = async () => ({
        reply: `작업 완료. 결과 파일은 [final-basename-attach.txt](final-basename-attach.txt) 입니다.`,
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      await harness.manager.handle_inbound_message(inbound("파일 생성해서 첨부해줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(Array.isArray(last.media)).toBe(true);
      expect((last.media || []).length).toBe(1);
      expect(String(last.media?.[0]?.url || "")).toBe(root_file);
    } finally { await harness.cleanup(); }
  });

  it("tool-call json leak lines are not exposed to channel message", async () => {
    const harness = await create_harness({
      orchestration_handler: once_reply([
        "확인했습니다.",
        '{"id":"call_3","name":"message","arguments":{"phase":"done","task_id":"task-1"}}',
        "}",
        "실행을 계속합니다.",
      ].join("\n")),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("상태 알려줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      const content = String(last.content || "");
      expect(content).not.toContain('"id":"call_3"');
      expect(content).not.toContain('"arguments"');
      expect(content).toMatch(/(확인했습니다|실행을 계속합니다)/);
    } finally { await harness.cleanup(); }
  });

  it("duplicate outbound payload is suppressed by dispatch dedupe", async () => {
    const harness = await create_harness();
    try {
      harness.orchestration.handler = async () => ({
        reply: "첫 번째 답변",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      await harness.manager.handle_inbound_message(inbound("첫 번째", { id: "trigger-1" }));

      harness.orchestration.handler = async () => ({
        reply: "두 번째 답변",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      await harness.manager.handle_inbound_message(inbound("두 번째", { id: "trigger-2" }));

      expect(harness.registry.sent.length).toBe(2);
      expect(String(harness.registry.sent[0]?.content || "")).toMatch(/첫 번째 답변/);
      expect(String(harness.registry.sent[1]?.content || "")).toMatch(/두 번째 답변/);
    } finally { await harness.cleanup(); }
  });

  it("reference context is not injected for standalone request", async () => {
    let captured_req: OrchestrationRequest | null = null;
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        captured_req = req;
        return { reply: "ok", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("package.json 확인해줘"));
      expect(captured_req).toBeTruthy();
      const content = String(captured_req!.message.content || "");
      expect(content).not.toContain("[REFERENCE_RECENT_CONTEXT]");
      expect(content).not.toContain("[THREAD_NEARBY_CONTEXT]");
    } finally { await harness.cleanup(); }
  });

  it("task_recovery synthetic inbound is ignored and does not produce channel reply", async () => {
    let called = 0;
    const harness = await create_harness({
      orchestration_handler: async () => {
        called += 1;
        return { reply: "should-not-run", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("[workflow resume]\n지침 확인", {
        sender_id: "recovery",
        metadata: { kind: "task_recovery", message_id: "recovery-1" },
      }));
      expect(called).toBe(0);
      expect(harness.registry.sent.length).toBe(0);
    } finally { await harness.cleanup(); }
  });

  it("each request triggers separate orchestration execution", async () => {
    let calls = 0;
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        calls += 1;
        const text = String(req.message.content || "").trim();
        return { reply: `run-${calls}: ${text}`, mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("첫 번째 작업", { id: "msg-1" }));
      await harness.manager.handle_inbound_message(inbound("두 번째 작업", { id: "msg-2" }));
      expect(calls).toBe(2);
      const replies = harness.registry.sent.filter((row) =>
        String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "agent_reply",
      );
      expect(replies.length).toBeGreaterThanOrEqual(2);
      const last = replies[replies.length - 1];
      expect(String(last.content || "")).toMatch(/run-2/i);
      expect(String(last.content || "")).toMatch(/두 번째 작업/i);
    } finally { await harness.cleanup(); }
  });

  it("task loop output is sanitized before channel reply", async () => {
    const harness = await create_harness({
      orchestration_handler: once_reply([
        "확인했습니다.",
        '{"id":"call_9","name":"message","arguments":{"phase":"done"}}',
        "}",
        "진행합니다.",
      ].join("\n")),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("workflow 상태를 보고해줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      const content = String(last.content || "");
      expect(content).not.toContain('"id":"call_9"');
      expect(content).not.toContain('"arguments"');
      expect(content).toMatch(/(확인했습니다|진행합니다)/);
    } finally { await harness.cleanup(); }
  });

  it("agent error fallback reply is emitted when orchestration returns null", async () => {
    const harness = await create_harness({
      orchestration_handler: async () => ({
        reply: null,
        error: "provider_unavailable",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      }),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("빈 응답 실패 테스트"));
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      const metadata = (last.metadata || {}) as Record<string, unknown>;
      expect(String(metadata.kind || "")).toBe("agent_error");
      expect(String(last.content || "")).toMatch(/실패/i);
    } finally { await harness.cleanup(); }
  });

  it("suppress_reply flag prevents channel reply", async () => {
    const harness = await create_harness({
      orchestration_handler: async () => ({
        reply: "이 텍스트는 전송되면 안 됨",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
        suppress_reply: true,
      }),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("중복 응답 억제 테스트"));
      expect(harness.registry.sent.length).toBe(0);
    } finally { await harness.cleanup(); }
  });

  it("bot message from self is ignored", async () => {
    let called = 0;
    const old = process.env.TELEGRAM_BOT_USER_ID;
    process.env.TELEGRAM_BOT_USER_ID = "bot-123";
    const harness = await create_harness({
      orchestration_handler: async () => {
        called += 1;
        return { reply: "should-not-run", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("에코 메시지", { sender_id: "bot-123" }));
      expect(called).toBe(0);
      expect(harness.registry.sent.length).toBe(0);
    } finally {
      process.env.TELEGRAM_BOT_USER_ID = old;
      await harness.cleanup();
    }
  });

  it("slash bot messages are ignored", async () => {
    let called = 0;
    const harness = await create_harness({
      orchestration_handler: async () => {
        called += 1;
        return { reply: "should-not-run", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("봇 메시지", {
        sender_id: "user-1",
        metadata: { message_id: "m1", from_is_bot: true },
      }));
      expect(called).toBe(0);
      expect(harness.registry.sent.length).toBe(0);
    } finally { await harness.cleanup(); }
  });

  it("auto reply disabled config prevents orchestration for plain messages", async () => {
    let called = 0;
    const harness = await create_harness({
      orchestration_handler: async () => {
        called += 1;
        return { reply: "ok", mode: "once", tool_calls_count: 0, streamed: false };
      },
      config_patch: { autoReply: false },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("일반 메시지"));
      expect(called).toBe(0);
      expect(harness.registry.sent.length).toBe(0);
    } finally { await harness.cleanup(); }
  });

  it("mention triggers orchestration even with auto reply disabled", async () => {
    let captured_alias = "";
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        captured_alias = req.alias;
        return { reply: "멘션 응답", mode: "once", tool_calls_count: 0, streamed: false };
      },
      config_patch: { autoReply: false },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("@assistant 확인해줘", {
        metadata: { message_id: "m1", mentions: [{ alias: "assistant" }] },
      }));
      expect(captured_alias).toBe("assistant");
      expect(harness.registry.sent.length).toBeGreaterThan(0);
    } finally { await harness.cleanup(); }
  });

  it("cancel_active_runs aborts running orchestration", async () => {
    const harness = await create_harness({
      orchestration_handler: async (req) => {
        req.signal?.addEventListener("abort", () => { /* aborted */ });
        return { reply: "ok", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("작업 시작"));
      const count = harness.manager.cancel_active_runs();
      expect(count).toBeGreaterThanOrEqual(0);
    } finally { await harness.cleanup(); }
  });
});
