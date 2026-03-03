import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AgentBackend,
  AgentBackendId,
  AgentEvent,
  AgentEventSource,
  AgentFinishReason,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  ApprovalBridgeRequest,
  BackendCapabilities,
} from "../agent.types.js";
import { now_iso } from "../../utils/common.js";
import { sandbox_to_codex_policy, effort_to_codex } from "./convert.js";
import { sandbox_from_preset, type LlmUsage } from "../../providers/types.js";
import { CodexJsonRpcClient } from "./codex-jsonrpc.js";

type EmitFn = (event: AgentEvent) => void | Promise<void>;

/** Codex 빌트인 도구 이름 → SoulFlow 커스텀 도구 이름 매핑. 채널 표시 일관성. */
const CODEX_BUILTIN_NAME_MAP: Record<string, string> = {
  commandExecution: "exec",
  webSearch: "web_search",
  fileChange: "edit_file",
};

/**
 * Codex CLI app-server 모드를 JSON-RPC 2.0으로 제어하는 백엔드.
 * 프로세스를 한 번 spawn하고, thread/start → turn/start 로 실행을 위임.
 * SDK와 동일하게 native_tool_loop=true (내부에서 전체 tool loop 처리).
 */
export class CodexAppServerAgent implements AgentBackend {
  readonly id: AgentBackendId;
  readonly native_tool_loop = true;
  readonly supports_resume = true;
  readonly capabilities: BackendCapabilities = {
    approval: true,
    structured_output: true,
    thinking: false,
    budget_tracking: false,
    tool_filtering: true,
    tool_result_events: true,
    send_input: true,
    tool_executors: true,
  };

  private client: CodexJsonRpcClient | null = null;
  private initialized = false;

  constructor(private readonly config: {
    id?: string;
    command?: string;
    cwd?: string;
    model?: string;
    request_timeout_ms?: number;
  } = {}) {
    this.id = config.id ?? "codex_appserver";
  }

  is_available(): boolean {
    const command = this.config.command || "codex";
    try {
      execFileSync(command, ["--version"], { timeout: 3000, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const emit = options.hooks?.on_event;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };
    let thread_id: string | undefined;
    let result_content = "";
    let tool_calls_count = 0;

    _fire(emit, { type: "init", source, at: now_iso() });

    try {
      const rpc = await this._ensure_client();

      // thread 생성 또는 resume
      const sandbox_input = options.runtime_policy?.sandbox ?? sandbox_from_preset("full-auto");
      const codex = sandbox_to_codex_policy(sandbox_input, this.config.cwd || process.cwd());
      const model = options.model || this.config.model || undefined;

      // tool_executors → dynamicTools 스키마 등록 (item/tool/call로 실행)
      const dynamic_tools = options.tool_executors?.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
      }));

      if (options.resume_session?.session_id) {
        const res = await rpc.request("thread/resume", {
          threadId: options.resume_session.session_id,
          ...(model ? { model } : {}),
          sandbox: codex.sandbox,
          approvalPolicy: codex.approval_policy,
          cwd: this.config.cwd,
        }) as { thread?: { id?: string } };
        thread_id = res?.thread?.id || options.resume_session.session_id;
      } else {
        const res = await rpc.request("thread/start", {
          model,
          sandbox: codex.sandbox,
          approvalPolicy: codex.approval_policy,
          cwd: this.config.cwd,
          ...(dynamic_tools?.length ? { dynamicTools: dynamic_tools } : {}),
        }) as { thread?: { id?: string } };
        thread_id = res?.thread?.id;
      }

      if (!thread_id) {
        return this._error_result("codex_no_thread_id", 0);
      }

      const turn_result = await this._run_turn(rpc, thread_id, options, source, codex.turn_sandbox_policy, options.tool_executors);

      result_content = turn_result.content;
      tool_calls_count = turn_result.tools;

      if (turn_result.usage.prompt_tokens || turn_result.usage.completion_tokens) {
        _fire(emit, {
          type: "usage", source, at: now_iso(),
          tokens: {
            input: turn_result.usage.prompt_tokens || 0,
            output: turn_result.usage.completion_tokens || 0,
            cache_read: turn_result.usage.cache_read_input_tokens || undefined,
            cache_creation: turn_result.usage.cache_creation_input_tokens || undefined,
          },
        });
      }

      return {
        content: result_content || null,
        session: this._build_session(thread_id),
        tool_calls_count,
        usage: turn_result.usage,
        finish_reason: turn_result.finish_reason,
        parsed_output: turn_result.parsed_output,
        metadata: thread_id ? { thread_id } : {},
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      _fire(emit, { type: "error", source, at: now_iso(), error: msg });
      return this._error_result(msg, tool_calls_count);
    }
  }

  stop(): void {
    if (this.client) {
      this.client.stop();
      this.client = null;
      this.initialized = false;
    }
  }

  private async _ensure_client(): Promise<CodexJsonRpcClient> {
    if (this.client?.is_running()) return this.client;

    // 클라이언트 교체 시 항상 초기화 상태 리셋 (에러 없이 프로세스가 종료된 경우 대비)
    this.initialized = false;

    const command = this.config.command || "codex";
    this.client = new CodexJsonRpcClient({
      command,
      args: ["app-server", "--listen", "stdio://"],
      cwd: this.config.cwd,
      request_timeout_ms: this.config.request_timeout_ms || 120_000,
    });

    this.client.on("error", () => {
      this.client = null;
      this.initialized = false;
    });

    this.client.start();

    if (!this.initialized) {
      await this.client.request("initialize", {
        clientInfo: { name: "soulflow-orchestrator", title: "SoulFlow Orchestrator", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      this.client.notify("initialized");
      this.initialized = true;
    }

    return this.client;
  }

  private async _run_turn(
    rpc: CodexJsonRpcClient,
    thread_id: string,
    options: AgentRunOptions,
    source: AgentEventSource,
    turn_sandbox_policy?: Record<string, unknown>,
    tool_executors?: import("../tools/types.js").ToolLike[],
  ): Promise<{ content: string; tools: number; finish_reason: AgentFinishReason; usage: LlmUsage; parsed_output?: unknown }> {
    let content = "";
    let tool_count = 0;
    let turn_completed = false;
    let turn_id = "";
    let finish_reason: AgentFinishReason = "error";
    let input_tokens = 0;
    let output_tokens = 0;
    let cache_read = 0;
    let cache_creation = 0;
    let parsed_output: unknown;
    const emit = options.hooks?.on_event;
    const on_stream = options.hooks?.on_stream;
    const on_approval = options.hooks?.on_approval;

    // 외부 입력 버퍼링: send_input으로 받은 텍스트를 requestUserInput에 전달
    let pending_input_resolve: ((text: string) => void) | null = null;
    let buffered_input: string | null = null;

    if (options.register_send_input) {
      options.register_send_input((text) => {
        // turn/steer: 진행 중인 턴에 능동적으로 입력 추가
        if (turn_id) {
          rpc.request("turn/steer", {
            threadId: thread_id,
            expectedTurnId: turn_id,
            input: [{ type: "text", text }],
          }).catch(() => {});
        }
        // requestUserInput 버퍼링도 유지 (서버 요청 시 사용)
        if (pending_input_resolve) {
          const r = pending_input_resolve;
          pending_input_resolve = null;
          r(text);
        } else {
          buffered_input = text;
        }
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ content, tools: tool_count, finish_reason, usage: {} });
      }, this.config.request_timeout_ms || 120_000);

      const on_notification = (notification: { method: string; params: Record<string, unknown> }) => {
        const { method, params } = notification;

        // turn 시작 → turnId 캡처 (turn/interrupt에 필요)
        if (method === "turn/started" && params.threadId === thread_id) {
          const turn = params.turn as Record<string, unknown> | undefined;
          turn_id = String(turn?.id || params.turnId || "");
          return;
        }

        // agent 텍스트 스트리밍 + content_delta 이벤트
        if (method === "item/agentMessage/delta" && params.threadId === thread_id) {
          const delta = String(params.delta || "");
          content += delta;
          if (delta) {
            _fire(emit, { type: "content_delta", source, at: now_iso(), text: delta });
            if (on_stream) {
              void Promise.resolve(on_stream(delta)).catch(() => {});
            }
          }
          return;
        }

        // 아이템 시작 → tool_use 또는 contextCompaction
        if (method === "item/started" && params.threadId === thread_id) {
          const item = params.item as Record<string, unknown> | undefined;
          if (!item?.type) return;
          // contextCompaction: 컨텍스트 압축 시작 알림
          if (String(item.type) === "contextCompaction") {
            _fire(emit, {
              type: "compact_boundary", source, at: now_iso(),
              trigger: "auto", pre_tokens: 0,
            });
            if (on_stream) {
              void Promise.resolve(on_stream("\n📦 컨텍스트 압축 중...")).catch(() => {});
            }
            return;
          }
          const TOOL_ITEM_TYPES = ["commandExecution", "mcpToolCall", "fileChange", "webSearch", "dynamicToolCall"];
          if (TOOL_ITEM_TYPES.includes(String(item.type))) {
            tool_count++;
            const raw_type = String(item.type);
            const actual_name = raw_type === "dynamicToolCall"
              ? String(item.name || item.tool || raw_type)
              : (CODEX_BUILTIN_NAME_MAP[raw_type] || raw_type);
            _fire(emit, {
              type: "tool_use", source, at: now_iso(),
              tool_name: actual_name,
              tool_id: String(item.id || randomUUID().slice(0, 8)),
              params: (item.arguments as Record<string, unknown>) ?? {},
            });
          }
          return;
        }

        // 명령 실행 출력 스트리밍 (delta: string)
        if (method === "item/commandExecution/outputDelta" && params.threadId === thread_id) {
          const delta = String(params.delta || "");
          if (delta && on_stream) {
            void Promise.resolve(on_stream(`\n${delta}`)).catch(() => {});
          }
          return;
        }

        // 파일 변경 출력 스트리밍 (delta: object — { path, kind, diff } 등)
        if (method === "item/fileChange/outputDelta" && params.threadId === thread_id) {
          if (params.delta && on_stream) {
            const d = params.delta as Record<string, unknown>;
            const label = d.path ? `📄 ${d.path}` : JSON.stringify(d);
            void Promise.resolve(on_stream(`\n${label}`)).catch(() => {});
          }
          return;
        }

        // 아이템 완료 → tool_result + post_tool_use 콜백
        if (method === "item/completed" && params.threadId === thread_id) {
          const item = params.item as Record<string, unknown> | undefined;
          const RESULT_ITEM_TYPES = ["commandExecution", "mcpToolCall", "fileChange", "webSearch", "dynamicToolCall"];
          if (item?.type && RESULT_ITEM_TYPES.includes(String(item.type))) {
            const raw_item_type = String(item.type);
            const is_dynamic = raw_item_type === "dynamicToolCall";
            const tool_name = is_dynamic
              ? String(item.name || item.tool || raw_item_type)
              : (CODEX_BUILTIN_NAME_MAP[raw_item_type] || raw_item_type);
            const tool_result = String(item.output || item.result || "");
            // dynamicToolCall은 exitCode 대신 success 필드로 에러 판별
            const is_error = is_dynamic
              ? item.success === false
              : (item.exitCode !== 0 && item.exitCode !== undefined);
            _fire(emit, {
              type: "tool_result", source, at: now_iso(),
              tool_name, tool_id: String(item.id || ""),
              result: tool_result, is_error,
              params: (item.arguments as Record<string, unknown>) ?? {},
            });
            // dynamicToolCall은 item/tool/call 핸들러에서 post_tool_use 처리
            const post_tool = options.hooks?.post_tool_use;
            if (post_tool && !is_dynamic) {
              const ctx = { task_id: options.task_id, signal: options.abort_signal, ...options.tool_context };
              void Promise.resolve(post_tool(
                tool_name,
                (item.arguments as Record<string, unknown>) ?? {},
                tool_result, ctx, is_error,
              )).catch(() => {});
            }
          }
          return;
        }

        // turn 완료
        if (method === "turn/completed" && params.threadId === thread_id) {
          turn_completed = true;
          const turn = params.turn as Record<string, unknown> | undefined;
          const status = String(turn?.status || params.status || "completed");
          finish_reason = status === "completed" ? "stop"
            : status === "interrupted" ? "cancelled"
            : status === "max_turns" ? "max_turns"
            : status === "failed" ? "error"
            : "error";
          // 실패 시 turn.error에서 상세 에러 추출 + codexErrorInfo → finish_reason 정밀 매핑
          if (status === "failed" && turn?.error) {
            const te = turn.error as { message?: string; codexErrorInfo?: unknown; additionalDetails?: string };
            const err_msg = String(te.message || "turn_failed");
            const err_code = _extract_codex_error_type(te.codexErrorInfo);
            finish_reason = _codex_error_to_finish_reason(err_code);
            _fire(emit, {
              type: "error", source, at: now_iso(),
              error: err_msg, code: `codex:${err_code}`,
            });
          }
          // structured output 결과 캡처
          if (turn?.structuredOutput !== undefined) {
            parsed_output = turn.structuredOutput;
          }
          // tokenUsage: turn.tokenUsage (v2) 또는 params.usage (v1) 양쪽 지원
          const u = (turn?.tokenUsage || params.usage) as {
            input_tokens?: number; inputTokens?: number;
            output_tokens?: number; outputTokens?: number;
            cached_input_tokens?: number;
            cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
          } | undefined;
          if (u) {
            input_tokens = Number(u.input_tokens || u.inputTokens || 0);
            output_tokens = Number(u.output_tokens || u.outputTokens || 0);
            cache_read = Number(u.cache_read_input_tokens || u.cached_input_tokens || 0);
            cache_creation = Number(u.cache_creation_input_tokens || 0);
          }
          _fire(emit, {
            type: "complete", source, at: now_iso(),
            finish_reason, content,
          });
          cleanup();
          const usage: LlmUsage = (input_tokens || output_tokens)
            ? {
                prompt_tokens: input_tokens || undefined,
                completion_tokens: output_tokens || undefined,
                total_tokens: (input_tokens + output_tokens) || undefined,
                cache_read_input_tokens: cache_read || undefined,
                cache_creation_input_tokens: cache_creation || undefined,
              }
            : {};
          resolve({ content, tools: tool_count, finish_reason, usage, parsed_output });
          return;
        }

        // thread 종료 → 즉시 turn resolve (120초 타임아웃 방지)
        if (method === "thread/closed" && params.threadId === thread_id) {
          if (!turn_completed) {
            turn_completed = true;
            const reason = String(params.reason || "thread_closed");
            finish_reason = reason === "completed" ? "stop" : "error";
            _fire(emit, {
              type: "complete", source, at: now_iso(),
              finish_reason, content,
            });
            cleanup();
            resolve({ content, tools: tool_count, finish_reason, usage: {} });
          }
          return;
        }

        // 추론 요약 텍스트 스트리밍
        if (method === "item/reasoning/summaryTextDelta" && params.threadId === thread_id) {
          const delta = String(params.delta || "");
          if (delta && on_stream) {
            void Promise.resolve(on_stream(`\n💭 ${delta}`)).catch(() => {});
          }
          return;
        }

        // 파일 변경 diff 알림 (diff는 unified diff string)
        if (method === "turn/diff/updated" && params.threadId === thread_id) {
          const diff = String(params.diff || "");
          if (diff) {
            const file_count = (diff.match(/^diff --git /gm) || []).length;
            _fire(emit, {
              type: "content_delta", source, at: now_iso(),
              text: `\n📝 파일 ${file_count || "?"}개 변경`,
            });
          }
          return;
        }

        // 실행 계획 업데이트 (step별 상태 포함)
        if (method === "turn/plan/updated" && (params.turnId === turn_id || params.threadId === thread_id)) {
          const plan = params.plan as Array<{ step?: string; status?: string }> | undefined;
          if (plan?.length && on_stream) {
            const summary = plan.map((s) => {
              const icon = s.status === "completed" ? "✅" : s.status === "inProgress" ? "⏳" : "○";
              return `${icon} ${s.step || ""}`;
            }).join("\n");
            void Promise.resolve(on_stream(`\n📋 Plan:\n${summary}`)).catch(() => {});
          }
          return;
        }

        // 계획 텍스트 스트리밍
        if (method === "item/plan/delta" && params.threadId === thread_id) {
          const delta = String(params.delta || "");
          if (delta && on_stream) {
            void Promise.resolve(on_stream(delta)).catch(() => {});
          }
          return;
        }

        // 토큰 사용량 업데이트 (params.tokenUsage.total.{inputTokens, outputTokens, cachedInputTokens})
        if (method === "thread/tokenUsage/updated" && params.threadId === thread_id) {
          const token_usage = params.tokenUsage as {
            total?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningOutputTokens?: number };
          } | undefined;
          const total = token_usage?.total;
          if (total) {
            const in_t = Number(total.inputTokens || 0);
            const out_t = Number(total.outputTokens || 0);
            if (in_t || out_t) {
              input_tokens = in_t;
              output_tokens = out_t;
              cache_read = Number(total.cachedInputTokens || 0);
            }
          }
          return;
        }

        // model reroute 알림
        if (method === "model/rerouted" && params.threadId === thread_id) {
          _fire(emit, {
            type: "error", source, at: now_iso(),
            error: `model rerouted: ${String(params.fromModel || "?")} → ${String(params.toModel || "?")} (${String(params.reason || "unknown")})`,
            code: "codex:model_rerouted",
          });
          return;
        }

        // 에러 — willRetry=true면 서버가 재시도하므로 이벤트만 발행
        if (method === "error") {
          const err_obj = (params.error || params) as Record<string, unknown>;
          const msg = String(err_obj.message || params.message || "codex_turn_error");
          const code = _extract_codex_error_type(err_obj.codexErrorInfo);
          _fire(emit, {
            type: "error", source, at: now_iso(),
            error: msg, code: `codex:${code}`,
          });
          if (params.willRetry) return;
          cleanup();
          reject(new Error(`${code}: ${msg}`));
          return;
        }
      };

      const on_abort = () => {
        rpc.request("turn/interrupt", { threadId: thread_id, turnId: turn_id }).catch(() => {});
        _fire(emit, { type: "complete", source, at: now_iso(), finish_reason: "cancelled", content });
        cleanup();
        resolve({ content, tools: tool_count, finish_reason: "cancelled", usage: {} });
      };

      // tool_executors를 name→executor 맵으로 변환
      const tool_map = new Map<string, import("../tools/types.js").ToolLike>();
      if (tool_executors) {
        for (const t of tool_executors) tool_map.set(t.name, t);
      }

      // server_request: 서버가 승인, 사용자 입력, 도구 호출을 요청하는 JSON-RPC request
      const on_server_request = (req: { id: string | number; method: string; params: Record<string, unknown> }) => {
        // item/tool/call — Codex가 클라이언트 등록 도구를 호출
        if (req.method === "item/tool/call") {
          const tool_name = String(req.params.tool || "");
          const executor = tool_map.get(tool_name);
          if (!executor) {
            rpc.respond(req.id, { success: false, contentItems: [{ type: "inputText", text: `unknown tool: ${tool_name}` }] });
            return;
          }
          let args = (req.params.arguments ?? {}) as Record<string, unknown>;
          const pre_tool = options.hooks?.pre_tool_use;
          const post_tool = options.hooks?.post_tool_use;
          const tool_ctx = { task_id: options.task_id, signal: options.abort_signal, ...options.tool_context };
          const run_tool = async () => {
            if (pre_tool) {
              const decision = await pre_tool(tool_name, args, tool_ctx);
              if (decision.permission === "deny") {
                rpc.respond(req.id, { success: false, contentItems: [{ type: "inputText", text: `denied: ${decision.reason || "policy"}` }] });
                return;
              }
              if (decision.updated_params) args = decision.updated_params;
            }
            try {
              const result = await executor.execute(args, tool_ctx);
              rpc.respond(req.id, { success: true, contentItems: [{ type: "inputText", text: result }] });
              if (post_tool) void Promise.resolve(post_tool(tool_name, args, result, tool_ctx, false)).catch(() => {});
            } catch (err) {
              const err_msg = String(err);
              rpc.respond(req.id, { success: false, contentItems: [{ type: "inputText", text: err_msg }] });
              if (post_tool) void Promise.resolve(post_tool(tool_name, args, err_msg, tool_ctx, true)).catch(() => {});
            }
          };
          void run_tool();
          return;
        }

        // requestUserInput — 버퍼에 입력이 있으면 즉시 전달, 없으면 30초 대기 후 빈 배열
        if (req.method.includes("requestUserInput")) {
          if (req.params.threadId && req.params.threadId !== thread_id) return;
          const questions = req.params.questions as Array<{ id?: string }> | undefined;
          const q_id = questions?.[0]?.id || "default";
          const _build_answer = (text: string) => ({
            answers: [{ questionId: q_id, answer: text }],
          });
          if (buffered_input !== null) {
            rpc.respond(req.id, _build_answer(buffered_input));
            buffered_input = null;
            return;
          }
          pending_input_resolve = (text) => rpc.respond(req.id, _build_answer(text));
          setTimeout(() => {
            if (pending_input_resolve) {
              pending_input_resolve = null;
              rpc.respond(req.id, { answers: [] });
            }
          }, 30_000);
          return;
        }

        if (!req.method.includes("requestApproval")) return;
        if (req.params.threadId && req.params.threadId !== thread_id) return;

        if (!on_approval) {
          rpc.respond(req.id, "accept");
          return;
        }

        const is_file_change = req.method.includes("fileChange");
        // command는 프로토콜상 string[] — 표시용으로 join
        const raw_cmd = req.params.command;
        const cmd_str = Array.isArray(raw_cmd) ? raw_cmd.join(" ") : String(raw_cmd || "");
        const bridge_request: ApprovalBridgeRequest = {
          request_id: randomUUID().slice(0, 12),
          type: is_file_change ? "file_change" : "command_execution",
          detail: cmd_str || String(req.params.reason || ""),
          command: is_file_change ? undefined : cmd_str,
        };

        _fire(emit, {
          type: "approval_request", source, at: now_iso(),
          request: bridge_request,
        });

        void on_approval(bridge_request).then((decision) => {
          // Codex는 "accept"|"acceptForSession"|"decline"|"cancel" 4가지 구분
          const codex_decision = decision === "deny" ? "decline"
            : decision === "cancel" ? "cancel"
            : decision === "accept_session" ? "acceptForSession"
            : "accept";
          rpc.respond(req.id, codex_decision);
        }).catch(() => {
          rpc.respond(req.id, "decline");
        });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        rpc.removeListener("notification", on_notification);
        rpc.removeListener("server_request", on_server_request);
        options.abort_signal?.removeEventListener("abort", on_abort);
      };

      rpc.on("notification", on_notification);
      rpc.on("server_request", on_server_request);

      // 이미 aborted면 즉시 취소 (이벤트가 이미 발생했으므로 addEventListener 무효)
      if (options.abort_signal?.aborted) {
        on_abort();
        return;
      }
      options.abort_signal?.addEventListener("abort", on_abort, { once: true });

      const turn_model = options.model || this.config.model || undefined;
      rpc.request("turn/start", {
        threadId: thread_id,
        input: [{ type: "text", text: options.task }],
        model: turn_model,
        ...(options.effort ? { effort: effort_to_codex(options.effort) } : {}),
        ...(turn_sandbox_policy ? { sandboxPolicy: turn_sandbox_policy } : {}),
        ...(options.structured_output ? { outputSchema: options.structured_output } : {}),
        ...(options.system_prompt ? { settings: { developer_instructions: options.system_prompt } } : {}),
      }).then(() => {
        if (turn_completed) return;
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  private _build_session(thread_id?: string): AgentSession | null {
    if (!thread_id) return null;
    return { session_id: thread_id, backend: this.id, created_at: now_iso() };
  }

  private _error_result(message: string, tool_calls_count: number): AgentRunResult {
    return {
      content: `Error: ${message}`,
      session: null,
      tool_calls_count,
      usage: {},
      finish_reason: "error",
      metadata: { error: message },
    };
  }
}

/** fire-and-forget 이벤트 발행. */
function _fire(emit: EmitFn | undefined, event: AgentEvent): void {
  if (!emit) return;
  void Promise.resolve(emit(event)).catch(() => {});
}

/** codexErrorInfo에서 에러 타입 문자열 추출. 객체 `{ type: "..." }` 또는 문자열 또는 undefined 처리. */
function _extract_codex_error_type(info: unknown): string {
  if (!info) return "Other";
  if (typeof info === "string") return info;
  if (typeof info === "object") return String((info as Record<string, unknown>).type || "Other");
  return "Other";
}

/** codexErrorInfo type → AgentFinishReason 정밀 매핑. */
function _codex_error_to_finish_reason(error_type: string): AgentFinishReason {
  switch (error_type) {
    case "ContextWindowExceeded": return "max_tokens";
    case "UsageLimitExceeded": return "max_budget";
    default: return "error";
  }
}
