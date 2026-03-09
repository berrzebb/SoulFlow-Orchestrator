/**
 * ChannelManager — 추가 미커버 분기 커버리지 (cov5).
 * - send_command_reply: 커맨드 응답 렌더링 + 청크 전송
 * - send_error_reply: 에러 텍스트 포맷 + dispatch.send
 * - send_chunked: content 길이가 max_len 초과시 분할
 * - try_hitl_send_input: content 없음 / active_run 없음 / active_run 있음
 * - handle_mentions: alias = sender_id (건너뜀), cooldown
 * - resume_after_dashboard_approval: task_resume.resume_after_approval 반환값
 * - set_workflow_hitl
 */
import { describe, it, expect, vi } from "vitest";
import {
  create_harness, inbound,
  create_noop_logger, FakeChannelRegistry, FakeDispatchService,
  FakeOrchestrationService, create_test_channel_config,
} from "@helpers/harness.ts";
import { MessageBus } from "@src/bus/service.ts";
import { ChannelManager } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import type { ChannelRegistryLike } from "@src/channels/types.ts";
import type { DispatchService } from "@src/channels/dispatch.service.ts";
import type { OrchestrationService } from "@src/orchestration/service.ts";
import type { TaskResumeService } from "@src/channels/task-resume.service.ts";
import type { ApprovalService } from "@src/channels/approval.service.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class FakeApproval {
  async try_handle_text_reply(): Promise<{ handled: boolean }> { return { handled: false }; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(): void {}
}

class FakeTaskResume {
  constructor(private readonly resume_result = false) {}
  async try_resume(): Promise<null> { return null; }
  async resume_after_approval(): Promise<boolean> { return this.resume_result; }
  async cancel_task(): Promise<void> {}
  expire_stale() { return []; }
}

async function make_manager(
  ws: string,
  overrides: {
    registry?: any;
    approval?: any;
    task_resume?: any;
    config_patch?: any;
    bus?: any;
    bot_identity?: any;
    renderer?: any;
  } = {},
) {
  const logger = create_noop_logger();
  const registry = overrides.registry ?? new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orch = new FakeOrchestrationService();
  const task_resume = overrides.task_resume ?? new FakeTaskResume();
  const approval = overrides.approval ?? new FakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: ws, tokens: {} });
  const config = { ...create_test_channel_config(), ...(overrides.config_patch || {}) };
  const bus = overrides.bus ?? new MessageBus();
  const bot_identity = overrides.bot_identity ?? { get_bot_self_id: () => "", get_default_target: () => "" };

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router: new CommandRouter([]),
    orchestration: orch as unknown as OrchestrationService,
    approval: approval as unknown as ApprovalService,
    task_resume: task_resume as unknown as TaskResumeService,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: null,
    providers: {} as never,
    config,
    workspace_dir: ws,
    logger,
    bot_identity,
    session_store: null,
    renderer: overrides.renderer ?? null,
  });

  return { manager, registry, dispatch: dispatch as FakeDispatchService };
}

// ══════════════════════════════════════════════════
// send_command_reply
// ══════════════════════════════════════════════════

describe("ChannelManager — send_command_reply", () => {
  it("커맨드 응답 텍스트 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("!help", { provider: "slack" });
      await (manager as any).send_command_reply("slack", msg, "커맨드 결과 내용");
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("웹 provider → bus.publish_outbound 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const bus_spy = { publish_outbound: vi.fn().mockResolvedValue(undefined), publish_inbound: vi.fn(), subscribe_inbound: vi.fn().mockReturnValue(() => {}) } as any;
      const { manager } = await make_manager(ws, { bus: bus_spy });
      const msg = inbound("!help", { provider: "web" });
      await (manager as any).send_command_reply("web", msg, "웹 커맨드 결과");
      expect(bus_spy.publish_outbound).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_error_reply
// ══════════════════════════════════════════════════

describe("ChannelManager — send_error_reply", () => {
  it("에러 텍스트 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("작업 실행", { provider: "slack" });
      await (manager as any).send_error_reply("slack", msg, "soul", "타임아웃 오류", "run-123");
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_chunked — 분할 전송
// ══════════════════════════════════════════════════

describe("ChannelManager — send_chunked", () => {
  it("짧은 내용 → 1개 청크만", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      await (manager as any).send_chunked("slack", msg, "soul", "@user ", "짧은 응답", 4096, { kind: "agent_reply" });
      expect(dispatch_spy).toHaveBeenCalledTimes(1);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("긴 내용 → 여러 청크 분할", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      const long_content = "가나다 ".repeat(300); // 1200+ chars
      await (manager as any).send_chunked("slack", msg, "soul", "", long_content, 100, { kind: "agent_reply" });
      // max_len=100이므로 여러 청크로 분할됨
      expect(dispatch_spy.mock.calls.length).toBeGreaterThan(1);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("두 번째 청크 meta → kind=agent_reply_cont", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      const long_content = "A".repeat(500);
      await (manager as any).send_chunked("slack", msg, "soul", "", long_content, 50, { kind: "agent_reply" });
      // 두 번째 호출의 내용에 chunk_index가 포함된 meta
      if (dispatch_spy.mock.calls.length > 1) {
        const second_msg = dispatch_spy.mock.calls[1][1];
        expect(second_msg.metadata?.kind).toBe("agent_reply_cont");
      }
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// try_hitl_send_input
// ══════════════════════════════════════════════════

describe("ChannelManager — try_hitl_send_input", () => {
  it("content 없음 → false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("", { provider: "slack" });
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("active_run 없음 → false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("응답 내용", { provider: "slack" });
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("active_run 있음 + send_input 있음 → true", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const send_input_spy = vi.fn();
      // active_runs에 fake run 등록
      const fake_run = {
        abort: new AbortController(),
        provider: "slack",
        chat_id: "C123",
        alias: "soul",
        done: Promise.resolve(),
        send_input: send_input_spy,
      };
      (manager as any).active_runs.register("slack:C123:soul", fake_run);
      const msg = inbound("사용자 응답", { provider: "slack" });
      (msg as any).chat_id = "C123";
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(true);
      expect(send_input_spy).toHaveBeenCalledWith("사용자 응답");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// handle_mentions — cooldown 및 alias 필터
// ══════════════════════════════════════════════════

describe("ChannelManager — handle_mentions", () => {
  it("alias === sender_id → 자기 자신 언급, 건너뜀", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const invoke_spy = vi.fn();
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "soul";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      expect(invoke_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("cooldown 중인 alias → 건너뜀", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const invoke_spy = vi.fn();
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U001";
      // 먼저 cooldown 설정
      (manager as any).mention_cooldowns.set("slack:C001:soul", Date.now());
      (msg as any).chat_id = "C001";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      // cooldown 중이므로 invoke 미호출
      expect(invoke_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("새 alias → invoke_and_reply 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const invoke_spy = vi.fn().mockResolvedValue(undefined);
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello soul", { provider: "slack" });
      (msg as any).sender_id = "U001";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      expect(invoke_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// resume_after_dashboard_approval
// ══════════════════════════════════════════════════

describe("ChannelManager — resume_after_dashboard_approval", () => {
  it("resume_after_approval=false → false 반환 + 경고 로그", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws, { task_resume: new FakeTaskResume(false) });
      const result = await manager.resume_after_dashboard_approval({
        task_id: "task-1", tool_result: "{}", provider: "slack", chat_id: "C123",
      });
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("resume_after_approval=true → invoke_and_reply 호출 후 true 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws, { task_resume: new FakeTaskResume(true) });
      const invoke_spy = vi.fn().mockResolvedValue(undefined);
      (manager as any).invoke_and_reply = invoke_spy;
      const result = await manager.resume_after_dashboard_approval({
        task_id: "task-2", tool_result: "{}", provider: "slack", chat_id: "C123",
      });
      expect(result).toBe(true);
      expect(invoke_spy).toHaveBeenCalledWith("slack", expect.any(Object), expect.any(String), "task-2");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// set_workflow_hitl
// ══════════════════════════════════════════════════

describe("ChannelManager — set_workflow_hitl", () => {
  it("set_workflow_hitl → workflow_hitl 설정됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov5-"));
    try {
      const { manager } = await make_manager(ws);
      const fake_bridge = { try_resolve: vi.fn() } as any;
      manager.set_workflow_hitl(fake_bridge);
      expect((manager as any).workflow_hitl).toBe(fake_bridge);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});
