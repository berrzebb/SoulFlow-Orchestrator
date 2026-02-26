import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { MessageBus } from "../bus/index.js";
import type { RuntimeConfig } from "../config/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { ProviderRegistry } from "../providers/index.js";
import { parse_executor_preference, resolve_executor_provider } from "../providers/executor.js";
import type { CronJob, CronOnJob } from "./types.js";

type CronTarget = { provider: "slack" | "discord" | "telegram"; chat_id: string };

const CRON_BLOCKED_TOOL_NAMES = new Set(["spawn", "cron"]);

export type CronRuntimeHandlerDeps = {
  config: RuntimeConfig;
  bus: MessageBus;
  events: WorkflowEventService;
  agent_runtime: AgentRuntimeLike;
  providers: ProviderRegistry;
};

export function default_chat_for_provider(config: RuntimeConfig, provider: CronTarget["provider"]): string {
  if (provider === "slack") return String(config.channels.slack.default_channel || "").trim();
  if (provider === "discord") return String(config.channels.discord.default_channel || "").trim();
  return String(config.channels.telegram.default_chat_id || "").trim();
}

function resolve_fallback_target(config: RuntimeConfig): CronTarget | null {
  const provider = config.provider;
  const chat_id = default_chat_for_provider(config, provider);
  if (!chat_id) return null;
  return { provider, chat_id };
}

function resolve_cron_target(config: RuntimeConfig, job: CronJob): CronTarget | null {
  const explicit_provider = String(job.payload.channel || "").trim().toLowerCase();
  let provider: CronTarget["provider"] | null = null;
  if (!explicit_provider) {
    provider = config.provider;
  } else if (explicit_provider === "slack" || explicit_provider === "discord" || explicit_provider === "telegram") {
    provider = explicit_provider;
  } else {
    return null;
  }
  const chat_id = String(job.payload.to || default_chat_for_provider(config, provider) || "").trim();
  if (!chat_id) return null;
  return { provider, chat_id };
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
        at: new Date().toISOString(),
        metadata,
      });
    };
    if (!target) {
      const reason = `cron_target_unresolved:${job.id}`;
      await publish_notice(
        "cron",
        `⚠️ cron 실행 실패\n- id: ${job.id}\n- name: ${job.name}\n- error: ${reason}`,
        {
          kind: "cron_failed",
          job_id: job.id,
          error: reason,
        },
      );
      throw new Error(reason);
    }
    const run_ts = Date.now();
    const run_id = `cron-run:${job.id}:${run_ts}`;
    const task_id = `cron-task:${job.id}:${run_ts}`;
    const agent_alias = String(process.env.DEFAULT_AGENT_ALIAS || "assistant").trim() || "assistant";

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
          payload: {
            job_id: job.id,
            job_name: job.name,
            ...payload,
          },
          provider: target.provider,
          channel: target.provider,
          chat_id: target.chat_id,
          source: "system",
          detail: detail ?? null,
        });
      } catch {
        // keep scheduler non-blocking when event logging fails
      }
    };

    await append_event(
      "assign",
      `cron trigger: ${job.name}`,
      {
        schedule: job.schedule,
        deliver: job.payload.deliver,
      },
      String(job.payload.message || ""),
    );

    try {
      if (job.payload.deliver) {
        await publish_notice(
          "cron",
          `⏰ ${job.name}\n${job.payload.message}`.trim(),
          {
            kind: "cron_deliver",
            job_id: job.id,
          },
        );
        await append_event("done", `cron delivered: ${job.name}`, { mode: "deliver" });
        return "delivered";
      }

      await append_event("progress", `cron executing task: ${job.name}`, { mode: "agent_turn" });
      await publish_notice(
        "cron",
        `⏱ cron 작업 실행 시작\n- id: ${job.id}\n- name: ${job.name}`,
        {
          kind: "cron_run_start",
          job_id: job.id,
        },
      );
      const preferred = parse_executor_preference(String(process.env.ORCH_EXECUTOR_PROVIDER || "chatgpt"));
      const provider_id = resolve_executor_provider(preferred);
      const always_skills = deps.agent_runtime.get_always_skills();
      deps.agent_runtime.apply_tool_runtime_context({
        channel: target.provider,
        chat_id: target.chat_id,
      });
      const tool_definitions = deps.agent_runtime.get_tool_definitions();
      const result = await deps.agent_runtime.run_agent_loop({
        loop_id: `cron-loop-${job.id}-${Date.now()}`,
        agent_id: agent_alias,
        objective: String(job.payload.message || job.name || "scheduled task"),
        context_builder: deps.agent_runtime.get_context_builder(),
        providers: deps.providers,
        tools: tool_definitions,
        provider_id,
        current_message: String(job.payload.message || ""),
        history_days: [],
        skill_names: always_skills,
        channel: target.provider,
        chat_id: target.chat_id,
        max_turns: Math.max(1, Number(process.env.AGENT_LOOP_MAX_TURNS || deps.config.agentLoopDefaultMaxTurns || 8)),
        model: undefined,
        max_tokens: 1800,
        temperature: 0.3,
        check_should_continue: async () => false,
        on_tool_calls: async ({ tool_calls }) => {
          const outputs: string[] = [];
          for (const tool_call of tool_calls) {
            if (CRON_BLOCKED_TOOL_NAMES.has(String(tool_call.name || "").trim().toLowerCase())) {
              outputs.push(`[tool:${tool_call.name}] Error: disabled_in_cron_context`);
              continue;
            }
            const out = await deps.agent_runtime.execute_tool(
              tool_call.name,
              tool_call.arguments || {},
              {
                task_id,
                channel: target.provider,
                chat_id: target.chat_id,
                sender_id: "cron",
              },
            );
            outputs.push(`[tool:${tool_call.name}] ${out}`);
          }
          return outputs.join("\n");
        },
      });
      const final_content = String(result.final_content || "").trim();
      if (final_content) {
        await publish_notice(
          agent_alias,
          final_content,
          {
            kind: "cron_result",
            job_id: job.id,
            provider_id,
          },
        );
        await append_event("done", `cron task completed: ${job.name}`, { provider_id }, final_content);
        return final_content;
      }
      const fallback_done = `✅ cron 작업 완료\n- id: ${job.id}\n- name: ${job.name}\n- 결과 본문 없음(도구 실행만 완료)`;
      await publish_notice(
        "cron",
        fallback_done,
        {
          kind: "cron_result",
          job_id: job.id,
          provider_id,
          empty: true,
        },
      );
      await append_event("done", `cron task completed: ${job.name}`, { provider_id, empty: true }, fallback_done);
      return fallback_done;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await publish_notice(
        "cron",
        `⚠️ cron 실행 실패\n- id: ${job.id}\n- name: ${job.name}\n- error: ${reason}`,
        {
          kind: "cron_failed",
          job_id: job.id,
          error: reason,
        },
      );
      await append_event("blocked", `cron task failed: ${job.name}`, { error: reason }, reason);
      throw error;
    }
  };
}
