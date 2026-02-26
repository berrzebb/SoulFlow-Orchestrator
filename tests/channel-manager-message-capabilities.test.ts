import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentDomain } from "../src/agent/index.ts";
import { MessageBus } from "../src/bus/index.ts";
import type { InboundMessage, OutboundMessage } from "../src/bus/types.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import type { ChannelProvider } from "../src/channels/types.ts";
import { LlmResponse } from "../src/providers/types.ts";

type LoopLikeOptions = {
  objective?: string;
  current_message?: string;
  runtime_policy?: {
    permission_profile?: string;
    command_profile?: string;
  };
  on_tool_calls?: (args: {
    state: Record<string, unknown>;
    tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    response: LlmResponse;
  }) => Promise<string | null>;
};

type Harness = {
  workspace: string;
  bus: MessageBus;
  agent: AgentDomain;
  manager: ChannelManager;
  registry: FakeChannelRegistry;
  cleanup: () => Promise<void>;
};

class FakeChannelRegistry {
  readonly sent: OutboundMessage[] = [];
  readonly inbound_rows: InboundMessage[] = [];

  async start_all(): Promise<void> {
    // no-op
  }

  async stop_all(): Promise<void> {
    // no-op
  }

  list_channels(): Array<{ provider: ChannelProvider }> {
    return [{ provider: "telegram" }];
  }

  get_channel(): null {
    return null;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id: string }> {
    this.sent.push(message);
    return { ok: true, message_id: String(this.sent.length) };
  }

  async read(_provider: ChannelProvider, chat_id: string): Promise<InboundMessage[]> {
    return this.inbound_rows.filter((row) => row.chat_id === chat_id);
  }

  async find_latest_agent_mention(
    _provider: ChannelProvider,
    chat_id: string,
    agent_alias: string,
    limit = 50,
  ): Promise<InboundMessage | null> {
    const rows = this.inbound_rows
      .filter((row) => row.chat_id === chat_id)
      .slice(-Math.max(1, Math.min(200, Number(limit || 50))));
    const needle = `@${String(agent_alias || "").trim().toLowerCase()}`;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const content = String(rows[i]?.content || "").toLowerCase();
      if (content.includes(needle)) return rows[i] || null;
    }
    return null;
  }

  async set_typing(_provider: ChannelProvider, _chat_id: string, _typing: boolean): Promise<void> {
    // no-op
  }
}

function inbound(content: string, patch?: Partial<InboundMessage>): InboundMessage {
  const id = String(patch?.id || `msg-${Date.now()}`);
  const metadata = (patch?.metadata && typeof patch.metadata === "object")
    ? (patch.metadata as Record<string, unknown>)
    : {};
  return {
    id,
    provider: "telegram",
    channel: "telegram",
    sender_id: "user-1",
    chat_id: "chat-1",
    content,
    at: new Date().toISOString(),
    media: [],
    metadata: {
      message_id: id,
      ...metadata,
    },
    ...patch,
  };
}

function completed_state(): Record<string, unknown> {
  return {
    loopId: "loop-test",
    agentId: "assistant",
    objective: "test",
    currentTurn: 1,
    maxTurns: 1,
    checkShouldContinue: false,
    status: "completed",
    terminationReason: "done",
  };
}

async function remove_with_retry(path: string): Promise<void> {
  let last_error: unknown = null;
  for (let i = 0; i < 6; i += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      last_error = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 40 * (i + 1)));
    }
  }
  if (last_error) throw last_error;
}

async function create_harness(run_agent_loop: (options: LoopLikeOptions) => Promise<{ state: Record<string, unknown>; final_content: string | null }>): Promise<Harness> {
  const workspace = await mkdtemp(join(tmpdir(), "orchestrator-msg-"));
  const prev_workspace = process.env.WORKSPACE_DIR;
  const prev_streaming = process.env.CHANNEL_STREAMING_ENABLED;
  process.env.WORKSPACE_DIR = workspace;
  process.env.CHANNEL_STREAMING_ENABLED = "0";

  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, {
    providers: null,
    bus,
  });
  (agent.loop as unknown as { run_agent_loop: typeof run_agent_loop }).run_agent_loop = run_agent_loop;
  const registry = new FakeChannelRegistry();
  const manager = new ChannelManager({
    bus,
    registry,
    providers: {} as never,
    agent,
    auto_reply_on_plain_message: true,
  });

  const cleanup = async (): Promise<void> => {
    process.env.WORKSPACE_DIR = prev_workspace;
    process.env.CHANNEL_STREAMING_ENABLED = prev_streaming;
    await manager.stop();
    await agent.stop();
    await remove_with_retry(workspace);
  };

  return { workspace, bus, agent, manager, registry, cleanup };
}

async function start_file_server(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(body);
  });
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    const s = server as Server;
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("address_unavailable"));
        return;
      }
      resolve({ port: addr.port });
    });
  });
  return {
    url: `http://127.0.0.1:${address.port}/sample.txt`,
    close: async () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

test("message flow can execute just-bash path through exec tool", async () => {
  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_exec_1",
          name: "exec",
          arguments: { command: "echo JUST_BASH_OK" },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "no-output" };
  });
  try {
    assert.equal(harness.agent.tools.has("exec"), true);
    await harness.manager.handle_inbound_message(inbound("just-bash 경로 테스트"));
    assert.equal(harness.registry.sent.length > 0, true);
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    assert.match(String(last.content || ""), /JUST_BASH_OK/i);
  } finally {
    await harness.cleanup();
  }
});

test("message flow can execute agent-browser tool path", async () => {
  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_web_fetch_1",
          name: "web_fetch",
          arguments: { url: "not-a-url" },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "no-output" };
  });
  try {
    assert.equal(harness.agent.tools.has("web_fetch"), true);
    await harness.manager.handle_inbound_message(inbound("agentbrowser로 웹 확인해줘"));
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    assert.match(String(last.content || ""), /invalid_url/i);
  } finally {
    await harness.cleanup();
  }
});

test("message flow can request file upload via request_file tool", async () => {
  const harness = await create_harness(async (options) => {
    await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_file_request_1",
          name: "request_file",
          arguments: { prompt: "PDF 첨부해 주세요", accept: ["pdf"] },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: "요약\n- Spotify fallback 추가했습니다." };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("파일 첨부 요청해줘"));
    const outbound = await harness.bus.consume_outbound({ timeout_ms: 500 });
    assert.equal(Boolean(outbound), true);
    const metadata = (outbound?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(metadata.kind || ""), "file_request");
    assert.match(String(outbound?.content || ""), /\[FILE_REQUEST/i);
    assert.equal(harness.registry.sent.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test("message tool normalizes quoted relative media path to local attachment", async () => {
  const harness = await create_harness(async (options) => {
    await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_message_media_1",
          name: "message",
          arguments: {
            phase: "done",
            content: "파일 첨부 전송",
            media: ["\"runtime/reports/hello-attach.txt\""],
          },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: "전송 완료" };
  });
  try {
    const report_dir = join(harness.workspace, "runtime", "reports");
    await mkdir(report_dir, { recursive: true });
    const report_file = join(report_dir, "hello-attach.txt");
    await writeFile(report_file, "hello", "utf-8");

    await harness.manager.handle_inbound_message(inbound("파일 생성 후 첨부해"));
    const outbound = await harness.bus.consume_outbound({ timeout_ms: 800 });
    assert.equal(Boolean(outbound), true);
    const metadata = (outbound?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(metadata.kind || ""), "workflow_event");
    assert.equal(Array.isArray(outbound?.media), true);
    assert.equal((outbound?.media || []).length, 1);
    assert.equal(String(outbound?.media?.[0]?.url || ""), report_file);
  } finally {
    await harness.cleanup();
  }
});

test("message flow downloads linked file and analyzes via read_file tool", async () => {
  const server = await start_file_server("REPORT_42");
  const harness = await create_harness(async (options) => {
    const objective = String(options.objective || "");
    const attachment_line = objective
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+\.\s+/.test(line));
    assert.equal(Boolean(attachment_line), true);
    const file_path = String(attachment_line || "").replace(/^\d+\.\s+/, "").trim();
    assert.equal(Boolean(file_path), true);
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_read_file_1",
          name: "read_file",
          arguments: { path: file_path },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "no-output" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound(`이 파일 분석해줘: ${server.url}`));
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    assert.match(String(last.content || ""), /REPORT_42/);
  } finally {
    await server.close();
    await harness.cleanup();
  }
});

test("approval request is emitted and approved exec command runs", async () => {
  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_exec_approval_1",
          name: "exec",
          arguments: { command: "echo APPROVED_OK > approval-ok.txt" },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "approval-pending" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("파일 쓰기 작업 실행해줘"));
    const approval = await harness.bus.consume_outbound({ timeout_ms: 800 });
    assert.equal(Boolean(approval), true);
    const approval_meta = (approval?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(approval_meta.kind || ""), "approval_request");
    const request_id = String(approval_meta.request_id || "");
    assert.equal(Boolean(request_id), true);

    await harness.manager.handle_inbound_message(inbound(`✅ request_id:${request_id}`, { id: "approve-msg-1" }));
    const approval_result = harness.registry.sent.find((row) =>
      String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "approval_result"
    );
    assert.equal(Boolean(approval_result), true);
    assert.match(String(approval_result?.content || ""), /(승인 반영 완료|approval)/i);

    const written = await readFile(join(harness.workspace, "approval-ok.txt"), "utf-8");
    assert.match(written, /APPROVED_OK/i);
  } finally {
    await harness.cleanup();
  }
});

test("outside workspace file access requests approval then succeeds", async () => {
  const outside_dir = await mkdtemp(join(tmpdir(), "orchestrator-outside-"));
  const outside_file = join(outside_dir, "outside-check.txt");
  await writeFile(outside_file, "OUTSIDE_OK", "utf-8");

  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_read_outside_1",
          name: "read_file",
          arguments: { path: outside_file },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "approval-pending" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("워크스페이스 밖 파일 읽어줘"));
    const approval = await harness.bus.consume_outbound({ timeout_ms: 800 });
    assert.equal(Boolean(approval), true);
    const approval_meta = (approval?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(approval_meta.kind || ""), "approval_request");
    const request_id = String(approval_meta.request_id || "");
    assert.equal(Boolean(request_id), true);

    await harness.manager.handle_inbound_message(inbound(`✅ request_id:${request_id}`, { id: "approve-msg-outside-1" }));
    const approval_result = harness.registry.sent.find((row) =>
      String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "approval_result"
    );
    assert.equal(Boolean(approval_result), true);
    assert.match(String(approval_result?.content || ""), /OUTSIDE_OK/);
  } finally {
    await harness.cleanup();
    await rm(outside_dir, { recursive: true, force: true });
  }
});

test("network-needed request escalates runtime policy", async () => {
  let captured: LoopLikeOptions | null = null;
  const harness = await create_harness(async (options) => {
    captured = options;
    return { state: completed_state(), final_content: "ok" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("https://example.com 페이지를 확인해줘"));
    assert.equal(Boolean(captured), true);
    assert.equal(String(captured?.runtime_policy?.permission_profile || ""), "full-auto");
    assert.equal(String(captured?.runtime_policy?.command_profile || ""), "extended");
  } finally {
    await harness.cleanup();
  }
});

test("approved outside-workspace exec runs via native shell", async () => {
  const outside_dir = await mkdtemp(join(tmpdir(), "orchestrator-outside-exec-"));
  const outside_file = join(outside_dir, "outside-exec-check.txt");
  const escaped = outside_file.replace(/\\/g, "\\\\");
  const command = `powershell -NoProfile -Command "Set-Content -LiteralPath '${escaped}' -Value 'OUTSIDE_EXEC_OK'"`;

  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_exec_outside_1",
          name: "exec",
          arguments: { command },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: output || "approval-pending" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("워크스페이스 밖 경로에 파일 생성해줘"));
    const approval = await harness.bus.consume_outbound({ timeout_ms: 800 });
    assert.equal(Boolean(approval), true);
    const approval_meta = (approval?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(approval_meta.kind || ""), "approval_request");
    const request_id = String(approval_meta.request_id || "");
    assert.equal(Boolean(request_id), true);

    await harness.manager.handle_inbound_message(inbound(`✅ request_id:${request_id}`, { id: "approve-msg-outside-exec-1" }));
    const written = await readFile(outside_file, "utf-8");
    assert.match(written, /OUTSIDE_EXEC_OK/);
  } finally {
    await harness.cleanup();
    await rm(outside_dir, { recursive: true, force: true });
  }
});

test("quoted local path with spaces and korean is attached as media", async () => {
  const harness = await create_harness(async () => ({ state: completed_state(), final_content: "ok" }));
  try {
    const media_dir = join(harness.workspace, "runtime", "inbound-files", "telegram", "카카오톡 받은 파일");
    await mkdir(media_dir, { recursive: true });
    const media_file = join(media_dir, "KakaoTalk test 01.jpg");
    await writeFile(media_file, "not-a-real-jpg", "utf-8");

    (harness.agent.loop as unknown as { run_agent_loop: (options: LoopLikeOptions) => Promise<{ state: Record<string, unknown>; final_content: string | null }> }).run_agent_loop = async () => ({
      state: completed_state(),
      final_content: `분석 완료. 결과 이미지는 "${media_file}" 입니다.`,
    });

    await harness.manager.handle_inbound_message(inbound("첨부 결과 보내줘"));
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    assert.equal(Array.isArray(last.media), true);
    assert.equal((last.media || []).length, 1);
    assert.equal(String(last.media?.[0]?.url || ""), media_file);
  } finally {
    await harness.cleanup();
  }
});

test("tool-call json leak lines are not exposed to channel message", async () => {
  const harness = await create_harness(async () => ({
    state: completed_state(),
    final_content: [
      "확인했습니다.",
      "{\"id\":\"call_3\",\"name\":\"message\",\"arguments\":{\"phase\":\"done\",\"task_id\":\"task-1\"}}",
      "}",
      "실행을 계속합니다.",
    ].join("\n"),
  }));
  try {
    await harness.manager.handle_inbound_message(inbound("상태 알려줘"));
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    const content = String(last.content || "");
    assert.equal(content.includes("\"id\":\"call_3\""), false);
    assert.equal(content.includes("\"arguments\""), false);
    assert.match(content, /(확인했습니다|실행을 계속합니다)/);
  } finally {
    await harness.cleanup();
  }
});

test("duplicate outbound payload is suppressed within dedupe window", async () => {
  const harness = await create_harness(async () => ({ state: completed_state(), final_content: "ok" }));
  try {
    const outbound: OutboundMessage = {
      id: "dup-msg-1",
      provider: "telegram",
      channel: "telegram",
      sender_id: "assistant",
      chat_id: "chat-1",
      content: "중복 테스트 메시지",
      at: new Date().toISOString(),
      metadata: {
        kind: "agent_reply",
        trigger_message_id: "same-trigger-1",
      },
    };
    const first = await (harness.manager as unknown as {
      send_with_retry: (
        provider: ChannelProvider,
        message: OutboundMessage,
        options?: { allow_requeue?: boolean; source?: string },
      ) => Promise<{ ok: boolean; message_id?: string; error?: string }>;
    }).send_with_retry("telegram", outbound, { source: "test" });
    const second = await (harness.manager as unknown as {
      send_with_retry: (
        provider: ChannelProvider,
        message: OutboundMessage,
        options?: { allow_requeue?: boolean; source?: string },
      ) => Promise<{ ok: boolean; message_id?: string; error?: string }>;
    }).send_with_retry("telegram", outbound, { source: "test" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(harness.registry.sent.length, 1);
  } finally {
    await harness.cleanup();
  }
});

test("agent final replies are deduped by trigger even when text differs", async () => {
  const harness = await create_harness(async () => ({ state: completed_state(), final_content: "ok" }));
  try {
    const first_msg: OutboundMessage = {
      id: "dup-agent-reply-1",
      provider: "telegram",
      channel: "telegram",
      sender_id: "assistant",
      chat_id: "chat-1",
      content: "첫 번째 답변",
      at: new Date().toISOString(),
      metadata: {
        kind: "agent_reply",
        trigger_message_id: "same-trigger-2",
      },
    };
    const second_msg: OutboundMessage = {
      ...first_msg,
      id: "dup-agent-reply-2",
      content: "두 번째 답변(중복 차단 대상)",
    };
    const first = await (harness.manager as unknown as {
      send_with_retry: (
        provider: ChannelProvider,
        message: OutboundMessage,
        options?: { allow_requeue?: boolean; source?: string },
      ) => Promise<{ ok: boolean; message_id?: string; error?: string }>;
    }).send_with_retry("telegram", first_msg, { source: "test" });
    const second = await (harness.manager as unknown as {
      send_with_retry: (
        provider: ChannelProvider,
        message: OutboundMessage,
        options?: { allow_requeue?: boolean; source?: string },
      ) => Promise<{ ok: boolean; message_id?: string; error?: string }>;
    }).send_with_retry("telegram", second_msg, { source: "test" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(harness.registry.sent.length, 1);
    assert.match(String(harness.registry.sent[0]?.content || ""), /첫 번째 답변/);
  } finally {
    await harness.cleanup();
  }
});

test("mention reply path is deduped by trigger through channel manager", async () => {
  const harness = await create_harness(async () => ({ state: completed_state(), final_content: "ok" }));
  try {
    harness.registry.inbound_rows.push(inbound("@assistant 상태 알려줘", {
      id: "mention-trigger-1",
      metadata: { message_id: "mention-trigger-1" },
    }));

    const first = await harness.manager.route_agent_reply({
      provider: "telegram",
      chat_id: "chat-1",
      agent_alias: "assistant",
      content: "첫 번째 멘션 응답",
      mention_sender: true,
      sender_alias: "user-1",
      limit: 50,
      metadata: {
        kind: "agent_reply",
        trigger_message_id: "mention-trigger-1",
      },
    });
    const second = await harness.manager.route_agent_reply({
      provider: "telegram",
      chat_id: "chat-1",
      agent_alias: "assistant",
      content: "두 번째 멘션 응답(중복 차단 대상)",
      mention_sender: true,
      sender_alias: "user-1",
      limit: 50,
      metadata: {
        kind: "agent_reply",
        trigger_message_id: "mention-trigger-1",
      },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(harness.registry.sent.length, 1);
    assert.match(String(harness.registry.sent[0]?.content || ""), /첫 번째 멘션 응답/);
  } finally {
    await harness.cleanup();
  }
});

test("reference context is disabled for standalone request", async () => {
  let captured: LoopLikeOptions | null = null;
  const harness = await create_harness(async (options) => {
    captured = options;
    return { state: completed_state(), final_content: "ok" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("package.json 확인해줘"));
    const message = String((captured as unknown as { current_message?: string } | null)?.current_message || "");
    assert.equal(message.includes("[REFERENCE_RECENT_CONTEXT]"), false);
    assert.equal(message.includes("[THREAD_NEARBY_CONTEXT]"), false);
  } finally {
    await harness.cleanup();
  }
});

test("task_recovery synthetic inbound is ignored and does not produce channel reply", async () => {
  let called = 0;
  const harness = await create_harness(async () => {
    called += 1;
    return { state: completed_state(), final_content: "should-not-run" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("[workflow resume]\n지침 확인", {
      sender_id: "recovery",
      metadata: {
        kind: "task_recovery",
        message_id: "recovery-1",
      },
    }));
    assert.equal(called, 0);
    assert.equal(harness.registry.sent.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test("task loop uses per-request task_id and does not reuse previous completed output", async () => {
  let calls = 0;
  const harness = await create_harness(async (options) => {
    calls += 1;
    const objective = String(options.objective || "").replace(/\s+/g, " ").trim();
    return { state: completed_state(), final_content: `run-${calls}: ${objective}` };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("workflow 첫 번째 작업"));
    await harness.manager.handle_inbound_message(inbound("workflow 두 번째 작업", { id: "msg-2" }));
    assert.equal(calls, 2);
    const replies = harness.registry.sent.filter((row) =>
      String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "agent_reply"
    );
    assert.equal(replies.length >= 2, true);
    const last = replies[replies.length - 1];
    assert.match(String(last.content || ""), /run-2/i);
    assert.match(String(last.content || ""), /두 번째 작업/i);
  } finally {
    await harness.cleanup();
  }
});

test("agent loop uses per-request task_id in tool execution context", async () => {
  const seen_task_ids: string[] = [];
  const harness = await create_harness(async (options) => {
    const output = await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_message_taskid_1",
          name: "message",
          arguments: {
            phase: "progress",
            content: "진행중",
          },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    const match = String(output || "").match(/task_id=([^\s]+)/i);
    if (match) seen_task_ids.push(String(match[1] || ""));
    return { state: completed_state(), final_content: "ok" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("첫번째 요청", { id: "agent-task-id-1" }));
    await harness.manager.handle_inbound_message(inbound("두번째 요청", { id: "agent-task-id-2" }));
    assert.equal(seen_task_ids.length >= 2, true);
    assert.match(String(seen_task_ids[0] || ""), /adhoc:telegram:chat-1:assistant:agent-task-id-1/i);
    assert.match(String(seen_task_ids[1] || ""), /adhoc:telegram:chat-1:assistant:agent-task-id-2/i);
    assert.notEqual(seen_task_ids[0], seen_task_ids[1]);
  } finally {
    await harness.cleanup();
  }
});

test("task loop output is sanitized before channel reply", async () => {
  const harness = await create_harness(async () => ({
    state: completed_state(),
    final_content: [
      "확인했습니다.",
      "{\"id\":\"call_9\",\"name\":\"message\",\"arguments\":{\"phase\":\"done\"}}",
      "}",
      "진행합니다.",
    ].join("\n"),
  }));
  try {
    await harness.manager.handle_inbound_message(inbound("workflow 상태를 보고해줘"));
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    const content = String(last.content || "");
    assert.equal(content.includes("\"id\":\"call_9\""), false);
    assert.equal(content.includes("\"arguments\""), false);
    assert.match(content, /(확인했습니다|진행합니다)/);
  } finally {
    await harness.cleanup();
  }
});

test("agent error fallback reply is emitted when provider returns empty output", async () => {
  const harness = await create_harness(async () => ({
    state: completed_state(),
    final_content: null,
  }));
  try {
    await harness.manager.handle_inbound_message(inbound("빈 응답 실패 테스트"));
    assert.equal(harness.registry.sent.length > 0, true);
    const last = harness.registry.sent[harness.registry.sent.length - 1];
    const metadata = (last.metadata || {}) as Record<string, unknown>;
    assert.equal(String(metadata.kind || ""), "agent_error");
    assert.match(String(last.content || ""), /실패/i);
  } finally {
    await harness.cleanup();
  }
});

test("message tool done phase suppresses duplicate final channel reply", async () => {
  const harness = await create_harness(async (options) => {
    await options.on_tool_calls?.({
      state: completed_state(),
      tool_calls: [
        {
          id: "call_message_done_1",
          name: "message",
          arguments: {
            phase: "done",
            content: "작업 완료 보고",
          },
        },
      ],
      response: new LlmResponse({ content: null }),
    });
    return { state: completed_state(), final_content: "최종 완료 요약" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("중복 응답 억제 테스트"));
    const outbound = await harness.bus.consume_outbound({ timeout_ms: 800 });
    assert.equal(Boolean(outbound), true);
    const metadata = (outbound?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(metadata.kind || ""), "workflow_event");
    assert.equal(harness.registry.sent.length, 0);
  } finally {
    await harness.cleanup();
  }
});
