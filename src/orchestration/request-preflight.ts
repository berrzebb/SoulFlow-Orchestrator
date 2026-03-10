/** Phase 4.4: Request Preflight 처리
 *
 * execute() 초반부의 request preprocessing을 한 곳으로 수렴.
 * seal, skill 검색, secret 검증, context 조립을 모두 여기서 수행.
 * resumed_task 분기도 여기서 처리하여 semantic 보존.
 */

import { join } from "node:path";
import type { RuntimeExecutionPolicy } from "../providers/types.js";
import type { ChannelProvider } from "../channels/types.js";
import type { ToolExecutionContext, ToolSchema } from "../agent/tools/types.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { RuntimePolicyResolver } from "../channels/runtime-policy.js";
import type { AppendWorkflowEventInput } from "../events/index.js";
import type { OrchestrationRequest } from "./types.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { is_local_reference } from "../utils/local-ref.js";
import { now_ms } from "../utils/common.js";
import { inbound_scope_id, compose_task_with_media, build_context_message, build_tool_context } from "./execution/helpers.js";
import { rebuild_tool_index } from "./tool-selector.js";

export type RequestPreflightDeps = {
  vault: SecretVaultService;
  runtime: AgentRuntimeLike;
  policy_resolver: RuntimePolicyResolver;
  workspace: string | undefined;
  tool_index: import("./tool-index.js").ToolIndex | null;
};

/** resumed_task 조기 반환 경로 */
export type ResumedPreflight = {
  kind: "resume";
  task_with_media: string;
  media: string[];
  resumed_task: import("../contracts.js").TaskState;
};

/** 정상 실행 경로 */
export type ReadyPreflight = {
  kind: "ready";
  task_with_media: string;
  media: string[];
  skill_names: string[];
  secret_guard: { ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] };
  runtime_policy: RuntimeExecutionPolicy;
  all_tool_definitions: Array<Record<string, unknown>>;
  request_scope: string;
  request_task_id: string;
  run_id: string;
  evt_base: Pick<AppendWorkflowEventInput, "run_id" | "task_id" | "agent_id" | "provider" | "channel" | "chat_id" | "source">;
  context_block: string;
  tool_ctx: ToolExecutionContext;
  skill_tool_names: string[];
  skill_provider_prefs: string[];
  category_map: Record<string, string>;
  tool_categories: string[];
  active_tasks_in_chat: import("../contracts.js").TaskState[];
};

export type RequestPreflightResult = ResumedPreflight | ReadyPreflight;

/** request 초기화 preflight 처리.
 *
 * 1. seal: 민감 정보 치환
 * 2. resumed 조기 반환 (seal 후, heavy computation 전)
 * 3. skill/secret/context 조립
 */
export async function run_request_preflight(
  deps: RequestPreflightDeps,
  req: OrchestrationRequest,
): Promise<RequestPreflightResult> {
  // 1. seal inputs — 항상 처음
  const raw_message = String(req.message.content || "").trim();
  const task = await seal_text(deps.vault, req.provider, req.message.chat_id, raw_message);
  const media = await seal_list(deps.vault, req.provider, req.message.chat_id, req.media_inputs);
  const task_with_media = compose_task_with_media(task, media);

  // 2. resumed_task 조기 반환 (seal 후, heavy 연산 전 — semantic 보존)
  if (req.resumed_task_id) {
    const resumed = await deps.runtime.get_task(req.resumed_task_id);
    if (resumed && resumed.status === "running") {
      return { kind: "resume", task_with_media, media, resumed_task: resumed };
    }
  }

  // 3. skills, secrets, context 조립 (resumed가 아닐 때만)
  const always_skills = deps.runtime.get_always_skills();
  const skill_names = resolve_context_skills(deps.runtime, task_with_media, always_skills);

  const secret_guard = await inspect_secrets(deps.vault, [task_with_media, ...media]);
  const runtime_policy = deps.policy_resolver.resolve(task_with_media, media);
  const all_tool_definitions = deps.runtime.get_tool_definitions();
  const request_scope = inbound_scope_id(req.message);
  const request_task_id = `adhoc:${req.provider}:${req.message.chat_id}:${req.alias}:${request_scope}`.toLowerCase();
  const run_id = req.run_id || `orch-${now_ms()}`;

  const evt_base: Pick<AppendWorkflowEventInput, "run_id" | "task_id" | "agent_id" | "provider" | "channel" | "chat_id" | "source"> = {
    run_id,
    task_id: request_task_id,
    agent_id: req.alias,
    provider: req.provider,
    channel: req.provider,
    chat_id: req.message.chat_id,
    source: "inbound",
  };

  const context_block = build_context_message(task_with_media);
  const tool_ctx = build_tool_context(req, request_task_id);

  const skill_tool_names = collect_skill_tool_names(deps.runtime, skill_names);
  const active_tasks_in_chat = deps.runtime.list_active_tasks().filter(
    (t) => String(t.memory?.chat_id || "") === String(req.message.chat_id),
  );
  const category_map: Record<string, string> = {};
  for (const tool of deps.runtime.get_tool_executors()) {
    category_map[tool.name] = tool.category;
  }
  const tool_categories = [...new Set(Object.values(category_map))];
  const tool_index_db = deps.workspace
    ? join(deps.workspace, "runtime", "tools", "tool-index.db")
    : undefined;
  rebuild_tool_index(all_tool_definitions as ToolSchema[], category_map, tool_index_db, deps.tool_index);
  const skill_provider_prefs = collect_skill_provider_prefs(deps.runtime, skill_names);

  return {
    kind: "ready",
    task_with_media,
    media,
    skill_names,
    secret_guard,
    runtime_policy,
    all_tool_definitions,
    request_scope,
    request_task_id,
    run_id,
    evt_base,
    context_block,
    tool_ctx,
    skill_tool_names,
    skill_provider_prefs,
    category_map,
    tool_categories,
    active_tasks_in_chat,
  };
}

/* ── Internal Helpers ── */

async function seal_text(vault: SecretVaultService, provider: ChannelProvider, chat_id: string, raw: string): Promise<string> {
  if (!raw.trim()) return "";
  try {
    const sealed = await seal_inbound_sensitive_text(raw, { provider, chat_id, vault });
    return sealed.text;
  } catch {
    return redact_sensitive_text(raw).text;
  }
}

async function seal_list(vault: SecretVaultService, provider: ChannelProvider, chat_id: string, values: string[]): Promise<string[]> {
  const tasks = values
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .map(async (raw) => {
      if (is_local_reference(raw)) return raw;
      const sealed = await seal_text(vault, provider, chat_id, raw);
      return sealed.trim() || null;
    });
  return (await Promise.all(tasks)).filter((v): v is string => v !== null);
}

async function inspect_secrets(
  vault: SecretVaultService,
  inputs: string[],
): Promise<{ ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] }> {
  const filtered = inputs.filter((t) => t.trim());
  const reports = await Promise.all(filtered.map((text) => vault.inspect_secret_references(text)));
  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const report of reports) {
    for (const k of report.missing_keys || []) {
      const n = String(k).trim();
      if (n) missing.add(n);
    }
    for (const t of report.invalid_ciphertexts || []) {
      const v = String(t).trim();
      if (v) invalid.add(v);
    }
  }
  return { ok: missing.size === 0 && invalid.size === 0, missing_keys: [...missing], invalid_ciphertexts: [...invalid] };
}

function collect_skill_tool_names(runtime: AgentRuntimeLike, skill_names: string[]): string[] {
  const out = new Set<string>();
  for (const name of skill_names) {
    const meta = runtime.get_skill_metadata(name);
    if (meta) for (const t of meta.tools) out.add(t);
  }
  return [...out];
}

function resolve_context_skills(runtime: AgentRuntimeLike, task: string, base: string[]): string[] {
  const out = new Set<string>(base.filter(Boolean));
  for (const s of runtime.recommend_skills(task, 8)) {
    const name = String(s || "").trim();
    if (name) out.add(name);
  }
  return [...out];
}

/** 스킬 메타에서 preferred_providers 수집 (중복 제거, 순서 유지).
 * continue_task_loop에서도 재사용되므로 export.
 */
export function collect_skill_provider_prefs(runtime: AgentRuntimeLike, skill_names: string[]): string[] {
  const prefs: string[] = [];
  const seen = new Set<string>();
  for (const name of skill_names) {
    const meta = runtime.get_context_builder().skills_loader.get_skill_metadata(name);
    if (!meta?.preferred_providers?.length) continue;
    for (const p of meta.preferred_providers) {
      if (!seen.has(p)) {
        seen.add(p);
        prefs.push(p);
      }
    }
  }
  return prefs;
}



