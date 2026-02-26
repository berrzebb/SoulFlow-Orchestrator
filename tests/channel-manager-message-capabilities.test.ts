import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  async send(_provider: ChannelProvider, message: OutboundMessage): Promise<{ ok: boolean; message_id: string }> {
    this.sent.push(message);
    return { ok: true, message_id: String(this.sent.length) };
  }

  async read(_provider: ChannelProvider, chat_id: string): Promise<InboundMessage[]> {
    return this.inbound_rows.filter((row) => row.chat_id === chat_id);
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
    registry: registry as never,
    providers: {} as never,
    agent,
    auto_reply_on_plain_message: true,
  });

  const cleanup = async (): Promise<void> => {
    process.env.WORKSPACE_DIR = prev_workspace;
    process.env.CHANNEL_STREAMING_ENABLED = prev_streaming;
    await rm(workspace, { recursive: true, force: true });
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
    return { state: completed_state(), final_content: "파일 요청 완료" };
  });
  try {
    await harness.manager.handle_inbound_message(inbound("파일 첨부 요청해줘"));
    const outbound = await harness.bus.consume_outbound({ timeout_ms: 500 });
    assert.equal(Boolean(outbound), true);
    const metadata = (outbound?.metadata || {}) as Record<string, unknown>;
    assert.equal(String(metadata.kind || ""), "file_request");
    assert.match(String(outbound?.content || ""), /\[FILE_REQUEST/i);
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
