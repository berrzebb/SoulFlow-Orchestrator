/** ContainerCliAgent — Pty 기반 headless CLI 통합. AgentBackend 인터페이스 구현. */

import type { Logger } from "../../logger.js";
import type {
  AgentBackend, AgentBackendId, AgentRunOptions, AgentRunResult,
  AgentEventSource, BackendCapabilities,
} from "../agent.types.js";
import type { AgentOutputMessage, CliAdapter, BuildArgsOptions } from "./types.js";
import { classify_error, FailoverError } from "./types.js";
import { AgentBus } from "./agent-bus.js";
import { now_iso, error_message } from "../../utils/common.js";
import type { CliAuthService, CliType } from "../cli-auth.service.js";
import { AuthProfileTracker } from "./auth-profile-tracker.js";
import { evaluate_context_window_guard } from "./context-window-guard.js";
import type { ToolBridgeServer } from "./tool-bridge-server.js";
import { BRIDGE_MCP_CONFIG_CONTAINER_PATH } from "./tool-bridge-config.js";

const BASE_RETRY = 24;
const PER_PROFILE = 8;
const MAX_COMPACTION_ATTEMPTS = 3;

export type ContainerCliAgentOptions = {
  id: AgentBackendId;
  bus: AgentBus;
  adapter: CliAdapter;
  logger: Logger;
  /** Auth 프로파일 수. 재시도 상한 스케일링에 사용. */
  auth_profile_count?: number;
  /** 모델 failover 설정 여부. */
  fallback_configured?: boolean;
  /** 기본 환경변수 (API 키 등). */
  default_env?: Record<string, string>;
  /** CLI 인증 서비스 (주입 시 인증 상태 연동). */
  auth_service?: CliAuthService;
  /** 프로파일별 환경변수 맵. AuthProfileTracker와 함께 사용. */
  profile_key_map?: Map<number, Record<string, string>>;
  /** Tool Bridge 서버 (주입 시 MCP 도구 브릿지 활성화). */
  tool_bridge?: ToolBridgeServer;
};

/** 동적 재시도 상한. 프로파일 수에 비례. */
function resolve_max_iterations(profile_count: number): number {
  const scaled = BASE_RETRY + Math.max(1, profile_count) * PER_PROFILE;
  return Math.min(160, Math.max(32, scaled));
}

export class ContainerCliAgent implements AgentBackend {
  readonly id: AgentBackendId;
  readonly native_tool_loop = true;
  readonly supports_resume = true;
  readonly capabilities: BackendCapabilities;

  private readonly bus: AgentBus;
  private readonly adapter: CliAdapter;
  private readonly logger: Logger;
  private readonly auth_profile_count: number;
  private readonly fallback_configured: boolean;
  private readonly default_env: Record<string, string>;
  private readonly auth_service?: CliAuthService;
  private readonly cli_type: CliType;
  private readonly profile_tracker: AuthProfileTracker | null;
  private readonly profile_key_map: Map<number, Record<string, string>>;
  private readonly tool_bridge?: ToolBridgeServer;
  private auth_ok: boolean;

  constructor(options: ContainerCliAgentOptions) {
    this.id = options.id;
    this.bus = options.bus;
    this.adapter = options.adapter;
    this.logger = options.logger;
    this.auth_profile_count = options.auth_profile_count ?? 1;
    this.fallback_configured = options.fallback_configured ?? false;
    this.default_env = options.default_env ?? {};
    this.auth_service = options.auth_service;
    this.cli_type = options.adapter.cli_id as CliType;
    this.auth_ok = !options.auth_service;
    this.profile_key_map = options.profile_key_map ?? new Map();
    this.tool_bridge = options.tool_bridge;
    this.profile_tracker = this.profile_key_map.size > 1
      ? new AuthProfileTracker(this.profile_key_map.size)
      : null;

    // 어댑터 능력에 따라 동적 설정
    this.capabilities = {
      approval: false,
      structured_output: false,
      thinking: false,
      budget_tracking: false,
      tool_filtering: this.adapter.supports_tool_filtering,
      tool_result_events: true,
      send_input: true,
      tool_executors: !!this.tool_bridge,
    };
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // resume 세션 키 우선 사용
    const base_session_key = options.resume_session?.session_id ?? options.task_id ?? `run-${Date.now()}`;
    let session_key = base_session_key;
    // options.max_turns 우선, 없으면 내부 상한
    const max_iterations = options.max_turns ?? resolve_max_iterations(this.auth_profile_count);
    const emit = options.hooks?.on_event;
    const on_stream = options.hooks?.on_stream;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };

    if (emit) emit({ type: "init", source, at: now_iso() });

    let iteration = 0;
    let compaction_attempts = 0;
    let total_usage = { input: 0, output: 0 };
    let last_content = "";
    let tool_calls_count = 0;

    // send_input 콜백 등록
    if (options.register_send_input) {
      options.register_send_input((text) => {
        this.bus.queue_followup(session_key, text);
      });
    }

    // 출력 이벤트를 AgentEvent로 변환
    const output_sub = this.bus.on_output((key, msg) => {
      if (key !== session_key) return;
      if (msg.type === "tool_use") tool_calls_count++;
      if (msg.type === "assistant_chunk" && on_stream) on_stream(msg.content);
      if (emit) this.relay_output_event(msg, source, emit);
    });

    try {
      // 어댑터가 시스템 프롬프트 전달을 지원하면 분리 전달, 아니면 task에 합침
      // Claude: --append-system-prompt, Codex: --config developer_instructions
      const system_prompt = this.adapter.supports_system_prompt_flag ? options.system_prompt : undefined;
      const original_task = options.task;
      let current_prompt = (!this.adapter.supports_system_prompt_flag && options.system_prompt)
        ? `${options.system_prompt}\n\n${original_task}`
        : original_task;

      // CLI 인수 옵션 조립
      const args_options: BuildArgsOptions = {
        session_key,
        system_prompt,
        model: options.model,
        max_turns: options.max_turns,
        allowed_tools: options.allowed_tools,
        disallowed_tools: options.disallowed_tools,
        add_dirs: options.add_dirs,
        ephemeral: options.ephemeral,
        max_budget_usd: options.max_budget_usd,
        json_schema: options.structured_output ? JSON.stringify(options.structured_output) : undefined,
        // Tool Bridge 활성 시 MCP 설정 주입 (컨테이너 내부 경로)
        mcp_config: this.tool_bridge ? BRIDGE_MCP_CONFIG_CONTAINER_PATH : undefined,
        // Codex fallback: MCP 미지원 → 도구 설명을 developer_instructions로 주입
        tool_definitions: this.tool_bridge && this.adapter.cli_id === "codex"
          ? this.build_tool_definitions()
          : undefined,
      };

      const env = { ...this.default_env, ...options.env };
      // 초기 프로파일 환경변수 주입
      if (this.profile_tracker) {
        Object.assign(env, this.profile_tracker.resolve_env(this.profile_key_map));
      }

      while (iteration++ < max_iterations) {
        if (options.abort_signal?.aborted) break;

        // Context Window Guard: 프롬프트 전송 전 토큰 추정
        const guard = evaluate_context_window_guard({ prompt_chars: current_prompt.length });
        if (!guard.ok && guard.reason === "hard_block") {
          const guard_msg = `prompt too large: ~${guard.estimated_tokens} tokens`;
          this.logger.warn("context_window_guard_block", { session_key, estimated_tokens: guard.estimated_tokens });
          if (this.fallback_configured) {
            throw new FailoverError(guard_msg, { reason: "unknown", provider: this.id });
          }
          if (emit) emit({ type: "error", source, at: now_iso(), error: guard_msg });
          return this.build_result(null, "error", total_usage, session_key, tool_calls_count, guard_msg);
        }
        if (!guard.ok && guard.reason === "warn") {
          this.logger.warn("context_window_guard_warn", { session_key, estimated_tokens: guard.estimated_tokens });
        }

        const result = await this.bus.send_and_wait(session_key, current_prompt, args_options, env);

        if (result.type === "complete") {
          this.profile_tracker?.mark_good();
          last_content = result.result;
          if (result.usage) {
            total_usage.input += result.usage.input;
            total_usage.output += result.usage.output;
          }

          // followup 메시지 확인
          const followups = this.bus.lane_queue.drain_followups(session_key);
          if (followups.length > 0) {
            current_prompt = followups.join("\n\n");
            continue;
          }

          // collected 메시지 확인
          const collected = this.bus.lane_queue.drain_collected(session_key);
          if (collected) {
            current_prompt = collected;
            continue;
          }

          // HITL 대기: task 모드에서 사용자 입력을 기다림
          if (options.wait_for_input_ms && options.wait_for_input_ms > 0) {
            const waited = await this.bus.lane_queue.wait_for_followup(
              session_key, options.wait_for_input_ms,
            );
            if (waited) {
              current_prompt = waited.join("\n\n");
              continue;
            }
          }

          if (emit) emit({ type: "complete", source, at: now_iso(), finish_reason: "stop", content: last_content });
          return this.build_result(last_content, "stop", total_usage, session_key, tool_calls_count);
        }

        // ── Error Handling ──
        if (result.type !== "error") continue;

        const error_class = classify_error(result);
        const err_msg = result.message;

        if (error_class === "context_overflow") {
          if (compaction_attempts < MAX_COMPACTION_ATTEMPTS) {
            compaction_attempts++;
            // 기존 세션 파괴 → 새 세션으로 컴팩트 재시작
            const summary = last_content
              ? `[이전 세션 요약]\n${last_content.slice(-2000)}\n\n[컨텍스트 초과로 새 세션에서 계속]`
              : "";
            await this.bus.remove_session(session_key);
            session_key = `${base_session_key}:compact-${compaction_attempts}`;
            current_prompt = summary
              ? `${summary}\n\n계속해서 작업을 완료해주세요:\n${original_task}`
              : original_task;
            this.logger.debug("context overflow, compact restart", { session_key, attempt: compaction_attempts });
            if (emit) emit({ type: "compact_boundary", source, at: now_iso(), trigger: "auto", pre_tokens: 0 });
            continue;
          }
          if (emit) emit({ type: "error", source, at: now_iso(), error: "context overflow after recovery" });
          return this.build_result(null, "error", total_usage, session_key, tool_calls_count, err_msg);
        }

        if (error_class === "auth_error") {
          // 프로파일 순환 시도: 다음 가용 프로파일로 전환 후 재시도
          if (this.profile_tracker?.has_available()) {
            const next = this.profile_tracker.mark_failure();
            if (next !== null) {
              this.logger.debug("auth failed, rotating profile", { to: next });
              await this.bus.remove_session(session_key);
              session_key = `${base_session_key}:profile-${next}`;
              Object.assign(env, this.profile_tracker.resolve_env(this.profile_key_map));
              continue;
            }
          }
          if (this.fallback_configured) {
            throw new FailoverError(err_msg, { reason: "auth", provider: this.id });
          }
          if (emit) emit({ type: "error", source, at: now_iso(), error: err_msg });
          return this.build_result(null, "error", total_usage, session_key, tool_calls_count, err_msg);
        }

        if (error_class === "billing") {
          if (this.fallback_configured) {
            throw new FailoverError(err_msg, { reason: "quota", provider: this.id });
          }
          if (emit) emit({ type: "error", source, at: now_iso(), error: err_msg });
          return this.build_result(null, "error", total_usage, session_key, tool_calls_count, err_msg);
        }

        if (error_class === "rate_limit") {
          const delay = Math.min(1000 * Math.pow(2, Math.min(iteration, 6)), 60_000);
          this.logger.debug("rate limited, backoff", { session_key, delay_ms: delay });
          await sleep(delay);
          continue;
        }

        if (error_class === "crash") {
          this.logger.debug("crash, respawning", { session_key });
          await this.bus.remove_session(session_key);
          continue;
        }

        if (error_class === "failover" && this.fallback_configured) {
          throw new FailoverError(err_msg, { reason: "unknown", provider: this.id });
        }

        // fatal
        if (emit) emit({ type: "error", source, at: now_iso(), error: err_msg });
        return this.build_result(null, "error", total_usage, session_key, tool_calls_count, err_msg);
      }

      // max iterations exceeded
      if (emit) emit({ type: "error", source, at: now_iso(), error: "max iterations exceeded" });
      return this.build_result(last_content || null, "max_turns", total_usage, session_key, tool_calls_count);
    } catch (err) {
      if (err instanceof FailoverError) throw err;
      const msg = error_message(err);
      if (emit) emit({ type: "error", source, at: now_iso(), error: msg });
      return this.build_result(null, "error", total_usage, session_key, tool_calls_count, msg);
    } finally {
      output_sub.dispose();
    }
  }

  /** 인증 상태 확인. auth_service 미주입 시 항상 true. */
  async check_auth(): Promise<boolean> {
    if (!this.auth_service) { this.auth_ok = true; return true; }
    const status = await this.auth_service.check(this.cli_type);
    this.auth_ok = status.authenticated;
    return this.auth_ok;
  }

  is_available(): boolean {
    return this.auth_ok;
  }

  stop(): void {
    void this.bus.shutdown();
    if (this.tool_bridge) void this.tool_bridge.stop().catch(() => {});
  }

  private relay_output_event(
    msg: AgentOutputMessage,
    source: AgentEventSource,
    emit: NonNullable<AgentRunOptions["hooks"]>["on_event"],
  ): void {
    if (!emit) return;
    const at = now_iso();

    switch (msg.type) {
      case "assistant_chunk":
      case "assistant_message":
        emit({ type: "content_delta", source, at, text: msg.content });
        break;
      case "tool_use":
        emit({
          type: "tool_use", source, at,
          tool_name: String(msg.tool), tool_id: `pty-${Date.now()}`,
          params: (typeof msg.input === "object" && msg.input !== null
            ? msg.input as Record<string, unknown>
            : {}),
        });
        break;
      case "tool_result":
        emit({
          type: "tool_result", source, at,
          tool_name: String(msg.tool), tool_id: `pty-${Date.now()}`,
          result: msg.output,
        });
        break;
      // complete, error — run() 루프에서 직접 처리
    }
  }

  /** Codex fallback: bridge 도구 목록을 텍스트로 생성 (developer_instructions 주입). */
  private build_tool_definitions(): string {
    if (!this.tool_bridge) return "";
    const tools = this.tool_bridge.list_tools();
    if (tools.length === 0) return "";
    const lines = tools.map((t) => `- ${t.name}: ${t.description ?? "No description"}`);
    return [
      "## Available External Tools (via orchestrator)",
      "The orchestrator can execute these tools on your behalf:",
      ...lines,
      "To use a tool, describe what you need clearly and the orchestrator will handle execution.",
    ].join("\n");
  }

  private build_result(
    content: string | null,
    finish_reason: AgentRunResult["finish_reason"],
    usage: { input: number; output: number },
    session_key: string,
    tool_calls_count: number,
    error?: string,
  ): AgentRunResult {
    return {
      content,
      session: {
        session_id: this.adapter.session_id ?? session_key,
        backend: this.id,
        created_at: now_iso(),
      },
      tool_calls_count,
      usage: {
        prompt_tokens: usage.input,
        completion_tokens: usage.output,
      },
      finish_reason,
      metadata: error ? { error } : {},
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
