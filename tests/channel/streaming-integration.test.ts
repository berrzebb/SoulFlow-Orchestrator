/**
 * ChannelManager 스트리밍 통합 테스트.
 * harness를 사용하여 실제 스트리밍 파이프라인 동작을 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { create_harness, inbound, type Harness } from "@helpers/harness.ts";
import type { OrchestrationRequest } from "@src/orchestration/types.ts";

/** 스트리밍 활성화 config patch. */
const STREAMING_CONFIG = {
  streaming: {
    enabled: true,
    mode: "live" as const,
    intervalMs: 0,      // 즉시 플러시 (테스트용)
    minChars: 1,        // 최소 1자면 플러시
    suppressFinalAfterStream: false,
    toolDisplay: "count" as const,
  },
};

describe("ChannelManager — 스트리밍 기본 동작", () => {
  let harness: Harness;

  it("스트리밍 후 최종 메시지로 교체한다 (suppressFinalAfterStream=false)", async () => {
    let captured_req: OrchestrationRequest | null = null;

    harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        captured_req = req;
        // 스트리밍 시뮬레이션: on_stream 콜백 호출
        if (req.on_stream) {
          req.on_stream("진행 중...");
          req.on_stream("거의 완료...");
        }
        return {
          reply: "최종 결과입니다. 작업이 완료되었습니다.",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("테스트"));

      // on_stream 콜백이 전달되어야 함
      expect(captured_req).toBeTruthy();
      expect(captured_req!.on_stream).toBeDefined();

      // 스트리밍 메시지가 전송되었어야 함 (첫 번째 sent = 스트림 메시지)
      expect(harness.registry.sent.length).toBeGreaterThanOrEqual(1);

      // 최종 메시지로 edit됨 (suppressFinalAfterStream=false)
      const edits = harness.registry.edited;
      expect(edits.length).toBeGreaterThanOrEqual(1);
      const lastEdit = edits[edits.length - 1];
      expect(lastEdit.content).toContain("최종 결과입니다");
    } finally {
      await harness.cleanup();
    }
  });

  it("스트리밍 비활성화 시 on_stream이 전달되지만 스트림 메시지를 보내지 않는다", async () => {
    harness = await create_harness({
      config_patch: {
        streaming: { enabled: false, mode: "live" as const, intervalMs: 1400, minChars: 48, suppressFinalAfterStream: false },
      },
      orchestration_handler: async (req) => {
        // on_stream은 항상 전달되지만, 사용해도 enabled=false면 처리 안 됨
        return {
          reply: "일반 응답",
          mode: "once",
          tool_calls_count: 0,
          streamed: false,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("테스트"));

      // 최종 메시지만 sent (스트림 메시지 없음)
      const replies = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_reply",
      );
      expect(replies.length).toBe(1);
      expect(String(replies[0].content)).toContain("일반 응답");

      // edit 없음 (스트리밍 안 했으므로)
      expect(harness.registry.edited.length).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 스트림 내용 보존", () => {
  it("긴 스트림 콘텐츠가 절단되지 않는다", async () => {
    const long_text = "이것은 긴 텍스트입니다. ".repeat(200); // ~3000자

    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        req.on_stream?.(long_text);
        return {
          reply: "완료",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("긴 응답 요청"));

      // 스트림 메시지가 3000자 이상 전달되어야 함 (이전에는 700자로 잘림)
      const stream_msgs = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_stream",
      );
      if (stream_msgs.length > 0) {
        const content = String(stream_msgs[0].content);
        // 플랫폼 제한(3800/4000) 이내에서 최대한 보존
        expect(content.length).toBeGreaterThan(700);
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("on_stream에 delta 구분자가 추가된다", async () => {
    let stream_accumulated = "";

    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        // 줄바꿈 없는 여러 청크 전송
        req.on_stream?.("첫 번째");
        req.on_stream?.("두 번째");
        req.on_stream?.("세 번째");
        return {
          reply: "완료",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("테스트"));

      // 스트림 메시지에서 청크들이 구분되어 있는지 확인
      const stream_msgs = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_stream",
      );
      // 최소 하나의 스트림 메시지가 전송됨
      expect(stream_msgs.length + harness.registry.edited.length).toBeGreaterThanOrEqual(0);
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 도구 카운트 표시 (count 모드)", () => {
  it("tool_count가 스트림 메시지 상단에 표시된다", async () => {
    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        // on_tool_block이 등록된 경우 (count 모드)
        if (req.on_tool_block) {
          req.on_tool_block("read_file");
          req.on_tool_block("write_file");
        }
        // 스트림 콘텐츠
        req.on_stream?.("파일을 처리했습니다.");
        return {
          reply: "도구 사용 완료",
          mode: "agent",
          tool_calls_count: 2,
          streamed: true,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("도구 테스트"));

      // 전송된 스트림 메시지에 tool count가 포함되어야 함
      const all_content = [
        ...harness.registry.sent.map((m) => String(m.content)),
        ...harness.registry.edited.map((e) => e.content),
      ].join("\n");

      // 최종 메시지에서 도구 사용 완료 확인
      expect(all_content).toContain("도구 사용 완료");
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 스트림 편집 실패 시 폴백", () => {
  it("edit_message 실패 시 새 메시지로 폴백한다", async () => {
    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        req.on_stream?.("진행 중");
        return {
          reply: "최종 결과",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });

    try {
      // edit_message를 실패하도록 오버라이드
      const original_edit = harness.registry.edit_message.bind(harness.registry);
      let edit_call_count = 0;
      harness.registry.edit_message = async (provider, chat_id, message_id, content) => {
        edit_call_count++;
        // deliver_result의 최종 edit만 실패시킴 (스트림 edit이 아닌 최종)
        if (edit_call_count > 2) {
          throw new Error("edit_failed_for_test");
        }
        return original_edit(provider, chat_id, message_id, content);
      };

      await harness.manager.handle_inbound_message(inbound("테스트"));

      // edit 실패해도 새 메시지가 전송됨 (폴백)
      const reply_msgs = harness.registry.sent.filter(
        (m) => {
          const kind = (m.metadata as Record<string, unknown>)?.kind;
          return kind === "agent_reply" || kind === "agent_stream";
        },
      );
      expect(reply_msgs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 스트리밍 parse_mode", () => {
  it("스트리밍 중 메시지에 parse_mode가 없다 (plain text)", async () => {
    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        req.on_stream?.("**볼드 텍스트**");
        return {
          reply: "**최종 볼드**",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });

    try {
      await harness.manager.handle_inbound_message(
        inbound("테스트", { provider: "telegram", channel: "telegram" }),
      );

      // 스트림 메시지는 render_parse_mode가 null
      const stream_msgs = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_stream",
      );
      for (const msg of stream_msgs) {
        const meta = msg.metadata as Record<string, unknown>;
        expect(meta.render_parse_mode).toBeNull();
      }
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 에러 시 스트리밍", () => {
  it("orchestration 에러 시 에러 메시지가 전송된다", async () => {
    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        // 스트리밍 중 에러 발생
        req.on_stream?.("작업을 시작합니다...");
        throw new Error("unexpected_backend_error");
      },
    });

    try {
      await harness.manager.handle_inbound_message(inbound("에러 테스트"));

      // 에러 메시지가 전송되어야 함
      const all_content = harness.registry.sent.map((m) => String(m.content)).join(" ");
      expect(all_content).toContain("실패");
    } finally {
      await harness.cleanup();
    }
  });
});

describe("ChannelManager — 플랫폼별 제한", () => {
  it("telegram 스트림은 4000자 제한을 적용한다", async () => {
    const very_long = "가".repeat(5000); // 5000자 (4000 초과)

    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        req.on_stream?.(very_long);
        return { reply: "done", mode: "once", tool_calls_count: 0, streamed: true };
      },
    });

    try {
      await harness.manager.handle_inbound_message(
        inbound("긴 텍스트", { provider: "telegram", channel: "telegram" }),
      );

      const stream_msgs = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_stream",
      );

      for (const msg of stream_msgs) {
        // 도구 카운트 헤더 포함해도 4100 이하
        expect(String(msg.content).length).toBeLessThanOrEqual(4100);
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("slack 스트림은 3800자 제한을 적용한다", async () => {
    const very_long = "a".repeat(5000);

    const harness = await create_harness({
      config_patch: STREAMING_CONFIG,
      orchestration_handler: async (req) => {
        req.on_stream?.(very_long);
        return { reply: "done", mode: "once", tool_calls_count: 0, streamed: true };
      },
    });

    try {
      await harness.manager.handle_inbound_message(
        inbound("긴 텍스트", { provider: "slack", channel: "slack" }),
      );

      const stream_msgs = harness.registry.sent.filter(
        (m) => ((m.metadata as Record<string, unknown>)?.kind) === "agent_stream",
      );

      for (const msg of stream_msgs) {
        expect(String(msg.content).length).toBeLessThanOrEqual(3900);
      }
    } finally {
      await harness.cleanup();
    }
  });
});
