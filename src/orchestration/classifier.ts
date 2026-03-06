/** 실행 모드 분류: 오케스트레이터 LLM 기반 once/agent/task/builtin/inquiry 판정. */

import type { ChatMessage } from "../providers/types.js";
import type { Logger } from "../logger.js";
import type { ClassificationResult } from "./types.js";
import {
  EXECUTION_MODE_DEFINITIONS,
  BASE_FLOWCHART,
  INQUIRY_DEFINITION,
  INQUIRY_FLOWCHART,
  build_active_task_context,
  build_classifier_capabilities,
} from "./prompts.js";
import { error_message } from "../utils/common.js";

export type SkillEntry = { name: string; summary: string; triggers: string[] };

export type ClassifierContext = {
  active_tasks?: import("../contracts.js").TaskState[];
  recent_history?: Array<{ role: string; content: string }>;
  available_tool_categories?: string[];
  available_skills?: SkillEntry[];
};

type OrchestratorProvider = {
  run_orchestrator(args: { messages: ChatMessage[]; max_tokens?: number; temperature?: number }): Promise<{ content?: unknown }>;
};

/** 오케스트레이터 LLM에게 실행 모드 분류를 위임. */
export async function classify_execution_mode(
  task: string,
  ctx: ClassifierContext,
  providers: OrchestratorProvider,
  logger: Logger,
): Promise<ClassificationResult> {
  const text = String(task || "").trim();
  if (!text) return { mode: "once" };
  if (!has_orchestrator(providers)) return { mode: "once" };

  const has_active = ctx.active_tasks && ctx.active_tasks.length > 0;

  const parts = [EXECUTION_MODE_DEFINITIONS];
  if (has_active) {
    parts.push(INQUIRY_DEFINITION);
    parts.push(INQUIRY_FLOWCHART);
    parts.push(build_active_task_context(ctx.active_tasks!));
  } else {
    parts.push(BASE_FLOWCHART);
  }
  const prompt = parts.join("\n");

  const user_parts = [`[REQUEST]\n${text}`];
  if (ctx.available_tool_categories?.length || ctx.available_skills?.length) {
    user_parts.push(build_classifier_capabilities(
      ctx.available_tool_categories || [],
      ctx.available_skills || [],
    ));
  }
  if (ctx.recent_history && ctx.recent_history.length > 0) {
    const history_block = ctx.recent_history.map((r) => `[${r.role}] ${r.content}`).join("\n");
    user_parts.push(`\n[RECENT_CONTEXT]\n${history_block}`);
  }

  try {
    const response = await providers.run_orchestrator({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: user_parts.join("\n\n") },
      ],
      max_tokens: 120,
      temperature: 0,
    });
    const raw = String(response.content || "");
    const parsed = parse_execution_mode(raw);
    if (parsed) {
      logger.info("classify_result", { mode: parsed.mode, raw: raw.slice(0, 120) });
      return parsed;
    }
    logger.warn("classify_parse_failed", { raw: raw.slice(0, 120) });
  } catch (e) {
    logger.warn("classify_error", { error: error_message(e) });
  }

  return { mode: "once" };
}

const RE_JSON_BLOCK = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/;
const RE_MODE_WORD = /\b(?:once|task|agent|inquiry|phase)\b/;
const RE_WHITESPACE_NORMALIZE = /[\s_-]+/g;
const RE_NEED_TASK_LOOP = /NEED\s*TASK\s*LOOP/i;
const RE_NEED_AGENT_LOOP = /NEED\s*AGENT\s*LOOP/i;

/** @internal — exported for unit testing. */
export function parse_execution_mode(raw: string): ClassificationResult | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const json_match = text.match(RE_JSON_BLOCK);
  if (json_match) {
    try {
      const obj = JSON.parse(json_match[0]) as Record<string, unknown>;
      const v = String(obj.mode || obj.route || "").trim().toLowerCase();
      if (v === "builtin") {
        const cmd = String(obj.command || "").trim();
        if (cmd) return { mode: "builtin", command: cmd, args: obj.args ? String(obj.args) : undefined };
        return null;
      }
      if (v === "inquiry") return { mode: "inquiry" };
      if (v === "phase") {
        const wid = obj.workflow_id ? String(obj.workflow_id) : undefined;
        const nodes = Array.isArray(obj.nodes)
          ? (obj.nodes as unknown[]).filter((t): t is string => typeof t === "string")
          : undefined;
        return { mode: "phase", workflow_id: wid, ...(nodes?.length ? { nodes } : {}) };
      }
      if (v === "once" || v === "task" || v === "agent") {
        const tools = Array.isArray(obj.tools)
          ? (obj.tools as unknown[]).filter((t): t is string => typeof t === "string")
          : undefined;
        return tools?.length ? { mode: v, tools } : { mode: v };
      }
    } catch { /* ignore */ }
  }
  const word = text.toLowerCase().match(RE_MODE_WORD);
  if (word) {
    if (word[0] === "phase") return { mode: "phase" };
    return { mode: word[0] as "once" | "agent" | "task" | "inquiry" };
  }
  return null;
}

/** @internal — exported for unit testing. */
export function detect_escalation(text: string): string | null {
  const normalized = text.replace(RE_WHITESPACE_NORMALIZE, " ").toUpperCase().trim();
  if (RE_NEED_TASK_LOOP.test(normalized)) return "once_requires_task_loop";
  if (RE_NEED_AGENT_LOOP.test(normalized)) return "once_requires_agent_loop";
  return null;
}

function has_orchestrator(providers: unknown): boolean {
  return !!providers && typeof (providers as Record<string, unknown>).run_orchestrator === "function";
}

export function is_once_escalation(error?: string | null): boolean {
  if (!error) return false;
  return error === "once_requires_task_loop" || error === "once_requires_agent_loop";
}
