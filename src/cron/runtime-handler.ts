import { error_message, now_iso} from "../utils/common.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentHooks } from "../agent/agent.types.js";
import { FINISH_REASON_WARNINGS } from "../agent/finish-reason-warnings.js";
import type { ToolSchema } from "../agent/tools/types.js";
import type { MessageBusLike } from "../bus/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { ProviderCapabilities } from "../providers/executor.js";
import { parse_executor_preference, resolve_executor_provider } from "../providers/executor.js";
import { sanitize_provider_output } from "../channels/output-sanitizer.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { CronJob, CronOnJob } from "./types.js";
import type { MessageProvider } from "../bus/types.js";

type CronTarget = { provider: MessageProvider; chat_id: string };

const CRON_BLOCKED_TOOL_NAMES = new Set(["spawn", "cron"]);

/** 턴당 최대 허용 시간 (ms). 기본값 600s. */
const DEFAULT_PER_TURN_TIMEOUT_MS = 600_000;

export type CronConfig = {
  agent_loop_max_turns: number;
  /** 턴당 최대 실행 시간 (ms). 총 잡 타임아웃은 max_turns × per_turn 으로 산출. */
  per_turn_timeout_ms?: number;
  default_alias: string;
  executor_provider: string;
  provider_caps: ProviderCapabilities;
  resolve_default_target: () => { provider: string; chat_id: string } | null;
};

/** 워크플로우 트리거 콜백. cron이 workflow_trigger:{slug}을 실행하면 호출. */
export type WorkflowTriggerCallback = (template_slug: string, channel: string, chat_id: string) => Promise<{ ok: boolean; workflow_id?: string; error?: string }>;

export type CronRuntimeHandlerDeps = {
  config: CronConfig;
  bus: MessageBusLike;
  events: WorkflowEventService;
  agent_runtime: AgentRuntimeLike;
  agent_backends: AgentBackendRegistry;
  secret_vault: SecretVaultService;
  on_workflow_trigger?: WorkflowTriggerCallback;
};


function resolve_fallback_target(config: CronConfig): CronTarget | null {
  const result = config.resolve_default_target();
  if (!result) return null;
  return { provider: result.provider, chat_id: result.chat_id };
}

function resolve_cron_target(config: CronConfig, job: CronJob): CronTarget | null {
  const explicit_provider = String(job.payload.channel || "").trim().toLowerCase();
  const explicit_to = String(job.payload.to || "").trim();
  if (explicit_provider && explicit_to) {
    return { provider: explicit_provider, chat_id: explicit_to };
  }
  const fallback = resolve_fallback_target(config);
  if (!fallback) return null;
  return {
    provider: explicit_provider || fallback.provider,
    chat_id: explicit_to || fallback.chat_id,
  };
}

export function create_cron_job_handler(deps: CronRuntimeHandlerDeps): CronOnJob {
  return async (job) => {
    const target = resolve_cron_target(deps.config, job);
    const fallback_target = target || resolve_fallback_target(deps.config);
    const publish_notice = async (
      sender_id: string,
      content: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      if (!fallback_target) return;
      await deps.bus.publish_outbound({
        id: `cron-notice-${job.id}-${Date.now()}`,
        provider: fallback_target.provider,
        channel: fallback_target.provider,
        sender_id,
        chat_id: fallback_target.chat_id,
        content,
        at: now_iso(),
        metadata,
      });
    };
    if (!target) {
      const reason = `cron_target_unresolved:${job.id}`;
      await publish_notice(
        "cron",
        `⚠️ cron 실행 실패\n- id: ${job.id}\n- name: ${job.name}\n- error: ${reason}`,
        { kind: "cron_failed", job_id: job.id, error: reason },
      );
      throw new Error(reason);
    }
    const run_ts = Date.now();
    const run_id = `cron-run:${job.id}:${run_ts}`;
    const task_id = `cron-task:${job.id}:${run_ts}`;
    const agent_alias = deps.config.default_alias;

    const append_event = async (
      phase: "assign" | "progress" | "blocked" | "done" | "approval",
      summary: string,
      payload?: Record<string, unknown>,
      detail?: string | null,
    ): Promise<void> => {
      try {
        await deps.events.append({
          event_id: `${run_id}:${phase}:${Date.now()}`,
          run_id,
          task_id,
          agent_id: agent_alias,
          phase,
          summary,
          payload: { job_id: job.id, job_name: job.name, ...payload },
          provider: target.provider,
          channel: target.provider,
          chat_id: target.chat_id,
          source: "system",
          detail: detail ?? null,
        });
      } catch {
        // 이벤트 로깅 실패가 스케줄러를 차단하면 안 됨
      }
    };

    await append_event(
      "assign",
      `cron trigger: ${job.name}`,
      { schedule: job.schedule, deliver: job.payload.deliver },
      String(job.payload.message || ""),
    );

    try {
      // workflow_trigger 모드: 워크플로우 템플릿 자동 실행
      const wf_prefix = "workflow_trigger:";
      if (job.payload.message.startsWith(wf_prefix) && deps.on_workflow_trigger) {
        const slug = job.payload.message.slice(wf_prefix.length).trim();
        const result = await deps.on_workflow_trigger(slug, target.provider, target.chat_id);
        if (result.ok) {
          await publish_notice("cron", `⏰ 워크플로우 실행: ${job.name}\nworkflow_id: ${result.workflow_id}`, { kind: "cron_workflow_trigger", job_id: job.id, workflow_id: result.workflow_id });
          await append_event("done", `cron workflow triggered: ${job.name}`, { mode: "workflow_trigger", workflow_id: result.workflow_id });
        } else {
          await publish_notice("cron", `⚠️ 워크플로우 트리거 실패: ${job.name}\nerror: ${result.error}`, { kind: "cron_workflow_failed", job_id: job.id, error: result.error });
          await append_event("blocked", `cron workflow trigger failed: ${job.name}`, { error: result.error });
        }
        return result.ok ? `workflow:${result.workflow_id}` : null;
      }

      // deliver 모드: 메시지만 전달하고 종료
      if (job.payload.deliver) {
        await publish_notice(
          "cron",
          `⏰ ${job.name}\n${job.payload.message}`.trim(),
          { kind: "cron_deliver", job_id: job.id },
        );
        await append_event("done", `cron delivered: ${job.name}`, { mode: "deliver" });
        return "delivered";
      }

      await append_event("progress", `cron executing task: ${job.name}`, { mode: "agent_turn" });
      await publish_notice(
        "cron",
        `⏱ cron 작업 실행 시작\n- id: ${job.id}\n- name: ${job.name}`,
        { kind: "cron_run_start", job_id: job.id },
      );

      // 백엔드 결정
      const preferred = parse_executor_preference(deps.config.executor_provider);
      const provider_id = resolve_executor_provider(preferred, deps.config.provider_caps);
      const backend_id = deps.agent_backends.resolve_backend_id(provider_id) ?? deps.agent_backends.list_backends()[0] ?? "claude_cli";
      const backend = deps.agent_backends.get_backend(backend_id);

      // 도구 준비
      const always_skills = deps.agent_runtime.get_always_skills();
      const tool_definitions = deps.agent_runtime.get_tool_definitions();
      const tool_executors = deps.agent_runtime.get_tool_executors();

      // 시스템 프롬프트 구성
      const context_builder = deps.agent_runtime.get_context_builder();
      const system_prompt = await context_builder.build_system_prompt(
        always_skills,
        undefined,
        { channel: target.provider, chat_id: target.chat_id },
      );

      // 크론 전용 hooks
      const hooks: AgentHooks = {
        pre_tool_use: async (name) => {
          if (CRON_BLOCKED_TOOL_NAMES.has(String(name || "").trim().toLowerCase())) {
            return { permission: "deny", reason: "disabled_in_cron_context" };
          }
          return {};
        },
      };

      const per_turn_ms = deps.config.per_turn_timeout_ms ?? DEFAULT_PER_TURN_TIMEOUT_MS;
      const job_timeout_ms = deps.config.agent_loop_max_turns * per_turn_ms;
      const cron_abort = new AbortController();
      const cron_timeout = setTimeout(() => cron_abort.abort(), job_timeout_ms);

      // 인바운드 텍스트 sealing: 크론 메시지도 민감 정보 보호 적용
      const raw_task = String(job.payload.message || job.name || "scheduled task");
      let sealed_task: string;
      try {
        const sealed = await seal_inbound_sensitive_text(raw_task, {
          provider: target.provider,
          chat_id: target.chat_id,
          vault: deps.secret_vault,
        });
        sealed_task = sealed.text;
      } catch {
        sealed_task = redact_sensitive_text(raw_task).text;
      }

      const caps = backend?.capabilities;
      try {
        const result = await deps.agent_backends.run(backend_id, {
          task: sealed_task,
          task_id,
          system_prompt,
          tools: tool_definitions as ToolSchema[],
          tool_executors,
          hooks,
          max_turns: Math.max(1, deps.config.agent_loop_max_turns),
          max_tokens: 8192,
          temperature: 0.3,
          effort: "high",
          ...(caps?.thinking ? { enable_thinking: true, max_thinking_tokens: 10000 } : {}),
          abort_signal: cron_abort.signal,
          tool_context: { channel: target.provider, chat_id: target.chat_id, sender_id: `cron:${job.id}` },
        });

        // finish_reason 분기: cancelled → 조용히 종료, 비정상 종료 → 경고 추가
        if (result.finish_reason === "cancelled") {
          await append_event("done", `cron task cancelled: ${job.name}`, { provider_id, backend_id, finish_reason: "cancelled" });
          return "cancelled";
        }

        // usage 추출
        const usage = result.usage as Record<string, unknown> | undefined;
        const usage_payload = usage ? {
          prompt_tokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
          completion_tokens: Number(usage.completion_tokens || usage.output_tokens || 0),
        } : undefined;

        const raw_content = String(result.content || "").trim();
        const warn = FINISH_REASON_WARNINGS[result.finish_reason];
        const sanitized = sanitize_provider_output(raw_content).trim();
        const final_content = warn ? (sanitized ? `${sanitized}\n\n⚠️ ${warn}` : `⚠️ ${warn}`) : sanitized;

        if (final_content) {
          await publish_notice(
            agent_alias,
            final_content,
            { kind: "cron_result", job_id: job.id, provider_id, backend_id, ...usage_payload ? { usage: usage_payload } : {} },
          );
          await append_event("done", `cron task completed: ${job.name}`, { provider_id, backend_id, finish_reason: result.finish_reason, ...usage_payload ? { usage: usage_payload } : {} }, final_content);
          return final_content;
        }
        const fallback_done = `✅ cron 작업 완료\n- id: ${job.id}\n- name: ${job.name}\n- 결과 본문 없음(도구 실행만 완료)`;
        await publish_notice(
          "cron",
          fallback_done,
          { kind: "cron_result", job_id: job.id, provider_id, backend_id, empty: true, ...usage_payload ? { usage: usage_payload } : {} },
        );
        await append_event("done", `cron task completed: ${job.name}`, { provider_id, backend_id, empty: true, ...usage_payload ? { usage: usage_payload } : {} }, fallback_done);
        return fallback_done;
      } finally {
        clearTimeout(cron_timeout);
      }
    } catch (error) {
      const reason = error_message(error);
      await publish_notice(
        "cron",
        `⚠️ cron 실행 실패\n- id: ${job.id}\n- name: ${job.name}\n- error: ${reason}`,
        { kind: "cron_failed", job_id: job.id, error: reason },
      );
      await append_event("blocked", `cron task failed: ${job.name}`, { error: reason }, reason);
      throw error;
    }
  };
}
