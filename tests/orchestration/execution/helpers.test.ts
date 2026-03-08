/** Phase 4.5+: helpers 모듈 테스트
 *
 * 목표: 결과 생성자, 컨텍스트 빌더, HITL 포맷 헬퍼 함수 테스트
 *       - 결과 생성자 (error_result, suppress_result, reply_result)
 *       - 요청 컨텍스트 빌더 (build_tool_context, compose_task_with_media 등)
 *       - HITL 포맷 및 타입 감지
 */

import { describe, it, expect } from "vitest";
import {
  error_result, suppress_result, reply_result, append_no_tool_notice,
  extract_usage, build_tool_context, compose_task_with_media,
  build_context_message, resolve_reply_to, raw_message_id, inbound_scope_id,
  format_hitl_prompt, detect_hitl_type,
} from "@src/orchestration/execution/helpers.js";
import type { InboundMessage } from "@src/bus/types.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

/* ── Mock Data ── */

const mockMessage: InboundMessage = {
  id: "msg-1",
  provider: "slack",
  channel: "general",
  sender_id: "user1",
  chat_id: "chat1",
  content: "test message",
  at: new Date().toISOString(),
  thread_id: "thread-1",
  metadata: { message_id: "slack-msg-123" },
};

const mockRequest: OrchestrationRequest = {
  message: mockMessage,
  provider: "slack",
  alias: "test",
  run_id: "run-1",
  media_inputs: [],
  session_history: [],
  signal: undefined as any,
};

/* ── Tests ── */

describe("helpers — 실행 헬퍼 함수", () => {
  describe("결과 생성자", () => {
    it("error_result: 에러 결과 생성", () => {
      const stream = new StreamBuffer();

      const result = error_result("agent", stream, "test_error", 2);

      expect(result.reply).toBeNull();
      expect(result.error).toBe("test_error");
      expect(result.mode).toBe("agent");
      expect(result.tool_calls_count).toBe(2);
      expect(result.streamed).toBe(false);
    });

    it("suppress_result: 억제 결과 생성", () => {
      const stream = new StreamBuffer();

      const result = suppress_result("task", stream, 1);

      expect(result.reply).toBeNull();
      expect(result.suppress_reply).toBe(true);
      expect(result.mode).toBe("task");
      expect(result.tool_calls_count).toBe(1);
    });

    it("reply_result: 일반 응답 생성", () => {
      const stream = new StreamBuffer();

      const result = reply_result("phase", stream, "task complete", 3, { result: "data" });

      expect(result.reply).toBe("task complete");
      expect(result.mode).toBe("phase");
      expect(result.tool_calls_count).toBe(3);
      expect(result.parsed_output).toEqual({ result: "data" });
    });

    it("append_no_tool_notice: 도구 미사용 안내 추가", () => {
      const original = "Task completed";

      const result = append_no_tool_notice(original);

      expect(result).toContain("Task completed");
      expect(result).toContain("작업이 완료되었습니다");
    });
  });

  describe("사용량 추출", () => {
    it("extract_usage: 토큰 사용량 추출", () => {
      const raw = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        total_cost_usd: 0.005,
      };

      const result = extract_usage(raw);

      expect(result).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        total_cost_usd: 0.005,
      });
    });

    it("extract_usage: 없는 필드는 제외", () => {
      const raw = {
        prompt_tokens: 100,
        completion_tokens: 50,
      };

      const result = extract_usage(raw);

      expect(result).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
      });
    });

    it("extract_usage: 모두 0이면 undefined 반환", () => {
      const raw = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost_usd: 0,
      };

      const result = extract_usage(raw);

      expect(result).toBeUndefined();
    });

    it("extract_usage: null 입력 → undefined", () => {
      const result = extract_usage(undefined);

      expect(result).toBeUndefined();
    });
  });

  describe("요청 컨텍스트 빌더", () => {
    it("build_tool_context: 요청으로부터 도구 컨텍스트 생성", () => {
      const result = build_tool_context(mockRequest, "task-1");

      expect(result.task_id).toBe("task-1");
      expect(result.channel).toBe("slack");
      expect(result.chat_id).toBe("chat1");
      expect(result.sender_id).toBe("user1");
      expect(result.reply_to).toBe("thread-1");
    });

    it("compose_task_with_media: 미디어 없음 → 원본 반환", () => {
      const task = "test task";

      const result = compose_task_with_media(task, []);

      expect(result).toBe("test task");
    });

    it("compose_task_with_media: 미디어 있음 → 파일 목록 추가", () => {
      const task = "analyze files";
      const media = ["file1.pdf", "file2.docx"];

      const result = compose_task_with_media(task, media);

      expect(result).toContain("analyze files");
      expect(result).toContain("[ATTACHED_FILES]");
      expect(result).toContain("1. file1.pdf");
      expect(result).toContain("2. file2.docx");
    });

    it("build_context_message: 히스토리 없음", () => {
      const task = "current task";

      const result = build_context_message(task, []);

      expect(result).toContain("[CURRENT_REQUEST]");
      expect(result).toContain("current task");
      expect(result).not.toContain("[REFERENCE_RECENT_CONTEXT]");
    });

    it("build_context_message: 히스토리 있음", () => {
      const task = "current task";
      const history = ["previous line 1", "previous line 2"];

      const result = build_context_message(task, history);

      expect(result).toContain("[CURRENT_REQUEST]");
      expect(result).toContain("[REFERENCE_RECENT_CONTEXT]");
      expect(result).toContain("previous line 1");
    });
  });

  describe("메시지 ID 관련 헬퍼", () => {
    it("resolve_reply_to (Slack): thread_id 우선", () => {
      const message: InboundMessage = {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: "thread-123",
        metadata: { message_id: "slack-msg-456" },
      };

      const result = resolve_reply_to("slack", message);

      expect(result).toBe("thread-123");
    });

    it("resolve_reply_to (Slack): thread_id 없음 → metadata.message_id", () => {
      const message: InboundMessage = {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: { message_id: "slack-msg-456" },
      };

      const result = resolve_reply_to("slack", message);

      expect(result).toBe("slack-msg-456");
    });

    it("resolve_reply_to (Telegram): 빈 문자열 반환", () => {
      const message: InboundMessage = {
        id: "msg-1",
        provider: "telegram",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: { message_id: "tg-msg-789" },
      };

      const result = resolve_reply_to("telegram", message);

      expect(result).toBe("");
    });

    it("raw_message_id: metadata에서 message_id 추출", () => {
      const message: InboundMessage = {
        id: "internal-id",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: { message_id: "external-msg-id" },
      };

      const result = raw_message_id(message);

      expect(result).toBe("external-msg-id");
    });

    it("inbound_scope_id: 유효한 문자만 필터링", () => {
      const message: InboundMessage = {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: { message_id: "msg@123#456" },
      };

      const result = inbound_scope_id(message);

      expect(result).toMatch(/^msg-123-456$/);
    });

    it("inbound_scope_id: 빈 message_id → 타임스탐프 생성", () => {
      const message: InboundMessage = {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "test",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: {},
      };

      const result = inbound_scope_id(message);

      expect(result).toMatch(/^msg-\d+$/);
    });
  });

  describe("HITL 포맷", () => {
    it("format_hitl_prompt: choice 타입", () => {
      const prompt = "Choose one: 1) Option A 2) Option B";

      const result = format_hitl_prompt(prompt, "task-1", "choice");

      expect(result).toContain("💬 **선택 요청**");
      expect(result).toContain("Option A");
      expect(result).toContain("Option B");
    });

    it("format_hitl_prompt: confirmation 타입", () => {
      const prompt = "Is this correct?";

      const result = format_hitl_prompt(prompt, "task-1", "confirmation");

      expect(result).toContain("💬 **확인 요청**");
      expect(result).toContain("Is this correct?");
    });

    it("format_hitl_prompt: 특수 마커 제거", () => {
      const prompt = "Choose: __request_user_choice__ [ASK_USER] option 1 option 2";

      const result = format_hitl_prompt(prompt, "task-1", "choice");

      expect(result).not.toContain("__request_user_choice__");
      expect(result).not.toContain("[ASK_USER]");
    });

    it("detect_hitl_type: confirmation 감지", () => {
      const result = detect_hitl_type("계속할까요?");

      expect(result).toBe("confirmation");
    });

    it("detect_hitl_type: choice 감지 (번호 목록)", () => {
      const result = detect_hitl_type("선택하세요:\n1) Option A\n2) Option B\n3) Option C");

      expect(result).toBe("choice");
    });

    it("detect_hitl_type: question (기본값)", () => {
      const result = detect_hitl_type("Please provide your input");

      expect(result).toBe("question");
    });
  });
});
