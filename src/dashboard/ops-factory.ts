/** Dashboard ops 팩토리. main.ts에서 분리된 7개 _create_*_ops() 함수. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { error_message } from "../utils/common.js";
import { create_logger } from "../logger.js";
import { SECTION_ORDER, SECTION_LABELS, type ConfigSection } from "../config/config-meta.js";
import { get_config_defaults, set_nested } from "../config/schema.js";
import { DEFAULT_TEMPLATES } from "../bootstrap-templates.js";
import { create_agent_provider, list_registered_provider_types } from "../agent/provider-factory.js";
import {
  fetch_openrouter_models, fetch_openai_models, fetch_anthropic_models,
  fetch_gemini_models, fetch_ollama_models, get_static_openai_models,
} from "../services/model-catalog.js";
import { get_preset as get_oauth_preset, list_presets as list_oauth_presets } from "../oauth/presets.js";
import { create_channel_instance, type ChannelRegistryLike } from "../channels/index.js";
import type {
  DashboardTemplateOps, DashboardChannelOps, ChannelStatusInfo,
  DashboardAgentProviderOps, ProviderConnectionInfo, BootstrapOps, DashboardOAuthOps, OAuthIntegrationInfo,
  DashboardMemoryOps, DashboardWorkspaceOps,
  DashboardSkillOps, DashboardConfigOps, DashboardToolOps, DashboardCliAuthOps,
  DashboardModelOps,
} from "./service.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentProviderStore } from "../agent/provider-store.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { ConfigStore } from "../config/config-store.js";
import type { OAuthIntegrationStore } from "../oauth/integration-store.js";
import type { OAuthFlowService } from "../oauth/flow-service.js";
import type { ChannelInstanceStore } from "../channels/instance-store.js";
import type { AppConfig } from "../config/schema.js";
import type { MemoryStoreLike } from "../agent/memory.types.js";
import type { McpClientManager } from "../mcp/index.js";
import type { OrchestratorLlmRuntime } from "../providers/orchestrator-llm.runtime.js";

/** 프로바이더 저장 → 토큰 설정 → 백엔드 등록을 한 번에 수행. */
async function activate_provider(
  store: AgentProviderStore,
  backends: AgentBackendRegistry,
  registry: ProviderRegistry,
  workspace: string,
  instance_id: string,
  token?: string | null,
): Promise<void> {
  if (token) await store.set_token(instance_id, token);
  const config = store.get(instance_id);
  if (!config) return;
  const resolved_token = await store.resolve_token(instance_id);
  const effective_config = apply_connection_api_base(store, config);
  const backend = create_agent_provider(effective_config, resolved_token, { provider_registry: registry, workspace });
  if (backend?.is_available()) backends.register(backend, effective_config);
}

/** connection의 api_base를 settings에 머지한 config를 반환. */
function apply_connection_api_base(store: AgentProviderStore, config: import("../agent/agent.types.js").AgentProviderConfig): import("../agent/agent.types.js").AgentProviderConfig {
  const resolved = store.resolve_api_base(config.instance_id);
  if (resolved && resolved !== config.settings.api_base) {
    return { ...config, settings: { ...config.settings, api_base: resolved } };
  }
  return config;
}

/** workspace 내부 상대 경로 sanitize. 디렉토리 탈출 방지. */
function sanitize_rel_path(rel_path: string): string {
  return rel_path.replace(/\.\./g, "").replace(/^[/\\]+/, "");
}

/** 파일명만 허용 (경로 구분자 금지). */
function sanitize_filename(name: string): string {
  return name.replace(/[\\/]/g, "").replace(/\.\./g, "");
}

/** resolve 결과가 base 디렉토리 내부인지 검증. */
function is_inside(base: string, target: string): boolean {
  const norm_base = resolve(base).toLowerCase();
  const norm_target = resolve(target).toLowerCase();
  return norm_target === norm_base || norm_target.startsWith(`${norm_base}/`) || norm_target.startsWith(`${norm_base}\\`);
}

// ─── Templates ─────────────────────────────────────────────────────────────

const TEMPLATE_NAMES = ["AGENTS", "SOUL", "HEART", "USER", "TOOLS", "HEARTBEAT"] as const;

export function create_template_ops(workspace: string): DashboardTemplateOps {
  const templates_dir = join(workspace, "templates");

  function resolve_path(name: string): string | null {
    const safe_name = sanitize_filename(name);
    if (!safe_name) return null;
    const in_templates = join(templates_dir, `${safe_name}.md`);
    if (is_inside(templates_dir, in_templates) && existsSync(in_templates)) return in_templates;
    const in_root = join(workspace, `${safe_name}.md`);
    if (is_inside(workspace, in_root) && existsSync(in_root)) return in_root;
    return null;
  }

  return {
    list() {
      return TEMPLATE_NAMES.map((name) => ({ name, exists: resolve_path(name) !== null }));
    },
    read(name: string) {
      const p = resolve_path(name);
      if (!p) return null;
      return readFileSync(p, "utf-8");
    },
    write(name: string, content: string) {
      const safe_name = sanitize_filename(name);
      if (!safe_name) return { ok: false };
      if (!mkdirSync(templates_dir, { recursive: true }) && !existsSync(templates_dir)) return { ok: false };
      const target = join(templates_dir, `${safe_name}.md`);
      if (!is_inside(templates_dir, target)) return { ok: false };
      writeFileSync(target, content, "utf-8");
      return { ok: true };
    },
  };
}

// ─── Channels ──────────────────────────────────────────────────────────────

const CHANNEL_TEST_URLS: Record<string, (token: string, api_base?: string) => { url: string; headers: Record<string, string> }> = {
  slack: (token) => ({ url: "https://slack.com/api/auth.test", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  discord: (token, api_base) => ({ url: `${api_base || "https://discord.com/api/v10"}/users/@me`, headers: { Authorization: `Bot ${token}` } }),
  telegram: (token, api_base) => ({ url: `${api_base || "https://api.telegram.org"}/bot${token}/getMe`, headers: {} }),
};

export function create_channel_ops(deps: {
  channels: ChannelRegistryLike;
  instance_store: ChannelInstanceStore;
  app_config: AppConfig;
}): DashboardChannelOps {
  const { channels, instance_store } = deps;
  const log = create_logger("channel-ops");

  function build_status(
    config: import("../channels/instance-store.js").ChannelInstanceConfig,
    health: import("../channels/types.js").ChannelHealth | null,
    has_token: boolean,
  ): ChannelStatusInfo {
    const settings = config.settings as Record<string, unknown>;
    const default_target = String(settings.default_channel || settings.default_chat_id || "");
    return {
      provider: config.provider,
      instance_id: config.instance_id,
      label: config.label,
      enabled: config.enabled,
      running: health?.running ?? false,
      healthy: health?.running ?? false,
      last_error: health?.last_error,
      token_configured: has_token,
      default_target,
      settings: config.settings,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  return {
    async list(): Promise<ChannelStatusInfo[]> {
      const instances = instance_store.list();
      const health_list = channels.get_health();
      const health_map = new Map(health_list.map((h) => [h.instance_id, h]));
      const results: ChannelStatusInfo[] = [];
      for (const config of instances) {
        const has_token = await instance_store.has_token(config.instance_id);
        results.push(build_status(config, health_map.get(config.instance_id) ?? null, has_token));
      }
      return results;
    },

    async get(instance_id: string): Promise<ChannelStatusInfo | null> {
      const config = instance_store.get(instance_id);
      if (!config) return null;
      const health = channels.get_health().find((h) => h.instance_id === instance_id) ?? null;
      const has_token = await instance_store.has_token(instance_id);
      return build_status(config, health, has_token);
    },

    async create(input): Promise<{ ok: boolean; error?: string }> {
      if (!input.instance_id || !input.provider) return { ok: false, error: "instance_id_and_provider_required" };
      if (instance_store.get(input.instance_id)) return { ok: false, error: "instance_already_exists" };
      const config = {
        instance_id: input.instance_id,
        provider: input.provider,
        label: input.label || input.instance_id,
        enabled: input.enabled ?? true,
        settings: input.settings || {},
      };
      instance_store.upsert(config);
      if (input.token) {
        await instance_store.set_token(input.instance_id, input.token);
      }
      const saved = instance_store.get(input.instance_id);
      if (saved?.enabled) {
        const token = await instance_store.get_token(saved.instance_id) || "";
        const ch = create_channel_instance(saved, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel created and started", { instance_id: saved.instance_id, provider: saved.provider });
          } catch (err) {
            log.warn("channel created but start failed", { instance_id: saved.instance_id, error: error_message(err) });
          }
        }
      }
      return { ok: true };
    },

    async update(instance_id, patch): Promise<{ ok: boolean; error?: string }> {
      const existing = instance_store.get(instance_id);
      if (!existing) return { ok: false, error: "not_found" };
      instance_store.update_settings(instance_id, {
        label: patch.label,
        enabled: patch.enabled,
        settings: patch.settings,
      });
      if (patch.token !== undefined) {
        if (patch.token) {
          await instance_store.set_token(instance_id, patch.token);
        } else {
          await instance_store.remove_token(instance_id);
        }
      }
      const old = channels.get_channel(instance_id);
      if (old?.is_running()) {
        try { await old.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      const updated = instance_store.get(instance_id);
      if (updated?.enabled) {
        const token = await instance_store.get_token(instance_id) || "";
        const ch = create_channel_instance(updated, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel hot-swapped", { instance_id, provider: updated.provider });
          } catch (err) {
            log.warn("channel hot-swap start failed", { instance_id, error: error_message(err) });
          }
        }
      } else {
        log.info("channel stopped (disabled)", { instance_id });
      }
      return { ok: true };
    },

    async remove(instance_id): Promise<{ ok: boolean; error?: string }> {
      const ch = channels.get_channel(instance_id);
      if (ch?.is_running()) {
        try { await ch.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      await instance_store.remove_token(instance_id);
      const removed = instance_store.remove(instance_id);
      if (removed) log.info("channel removed", { instance_id });
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_connection(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
      const config = instance_store.get(instance_id);
      if (!config) return { ok: false, error: "instance_not_found" };
      const token = await instance_store.get_token(instance_id) || "";
      if (!token) return { ok: false, error: "token_not_configured" };
      const builder = CHANNEL_TEST_URLS[config.provider];
      if (!builder) return { ok: false, error: "unsupported_provider" };
      const api_base = String((config.settings as Record<string, unknown>).api_base || "");
      const { url, headers } = builder(token, api_base || undefined);
      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
        if (!resp.ok) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, status: resp.status });
          return { ok: false, error: `HTTP ${resp.status}`, detail: JSON.stringify(body).slice(0, 200) };
        }
        if (config.provider === "slack" && body?.ok === false) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, error: String(body.error || "slack_auth_failed") });
          return { ok: false, error: String(body.error || "slack_auth_failed") };
        }
        const detail = config.provider === "slack"
          ? String(body?.team || "")
          : config.provider === "discord"
            ? String((body as Record<string, unknown>)?.username || "")
            : String((body as { result?: { username?: string } })?.result?.username || "");
        log.info("channel test_connection ok", { instance_id, provider: config.provider });
        return { ok: true, detail };
      } catch (e) {
        log.warn("channel test_connection error", { instance_id, provider: config.provider, error: error_message(e) });
        return { ok: false, error: error_message(e) };
      }
    },

    list_providers(): string[] {
      return [...new Set(instance_store.list().map((c) => c.provider))];
    },
  };
}

// ─── Agent Providers ───────────────────────────────────────────────────────

export function create_agent_provider_ops(deps: {
  provider_store: AgentProviderStore;
  agent_backends: AgentBackendRegistry;
  provider_registry: ProviderRegistry;
  workspace: string;
}): DashboardAgentProviderOps {
  const { provider_store, agent_backends, provider_registry, workspace } = deps;
  const log = create_logger("provider-ops");

  async function build_connection_info(conn: import("../agent/agent.types.js").ProviderConnection): Promise<ProviderConnectionInfo> {
    const has_token = await provider_store.has_connection_token(conn.connection_id);
    const preset_count = provider_store.count_presets_for_connection(conn.connection_id);
    return { ...conn, token_configured: has_token, preset_count };
  }

  /** provider_type에 해당하는 connection 토큰을 자동 탐색. */
  async function resolve_connection_key(provider_type: string): Promise<string | undefined> {
    const conns = provider_store.list_connections().filter((c) => c.provider_type === provider_type && c.enabled);
    for (const conn of conns) {
      const token = await provider_store.get_connection_token(conn.connection_id);
      if (token) return token;
    }
    return undefined;
  }

  async function do_list_models(provider_type: string, opts?: { api_key?: string; api_base?: string }) {
    const api_key = opts?.api_key || await resolve_connection_key(provider_type);
    const api_base = opts?.api_base;
    switch (provider_type) {
      case "openrouter":
        return fetch_openrouter_models(api_key);
      case "openai_compatible":
        return fetch_openai_models(api_base || "https://api.openai.com/v1", api_key);
      case "claude_sdk":
      case "claude_cli":
        return fetch_anthropic_models(api_key);
      case "gemini_cli":
        return fetch_gemini_models(api_key);
      case "codex_cli":
      case "codex_appserver":
        if (api_key) return fetch_openai_models("https://api.openai.com/v1", api_key);
        return get_static_openai_models();
      case "container_cli": {
        const [a, g, o] = await Promise.all([fetch_anthropic_models(), fetch_gemini_models(), Promise.resolve(get_static_openai_models())]);
        return [...a, ...g, ...o];
      }
      default:
        if (api_base) return fetch_ollama_models(api_base);
        return [];
    }
  }

  return {
    async list() {
      const configs = provider_store.list();
      const status_map = new Map(agent_backends.list_backend_status().map((s) => [s.id, s]));
      const token_checks = await Promise.all(configs.map((c) => provider_store.has_resolved_token(c.instance_id)));
      return configs.map((c, i) => {
        const s = status_map.get(c.instance_id);
        return { ...c, available: s?.available ?? false, circuit_state: s?.circuit_state ?? "closed", capabilities: s?.capabilities ?? null, token_configured: token_checks[i] };
      });
    },

    async get(instance_id) {
      const config = provider_store.get(instance_id);
      if (!config) return null;
      const status = agent_backends.list_backend_status().find((s) => s.id === instance_id);
      const has_token = await provider_store.has_resolved_token(instance_id);
      return { ...config, available: status?.available ?? false, circuit_state: status?.circuit_state ?? "closed", capabilities: status?.capabilities ?? null, token_configured: has_token };
    },

    async create(input) {
      if (!input.instance_id || !input.provider_type) return { ok: false, error: "instance_id_and_provider_type_required" };
      if (provider_store.get(input.instance_id)) return { ok: false, error: "instance_already_exists" };
      provider_store.upsert({
        instance_id: input.instance_id,
        provider_type: input.provider_type,
        label: input.label || input.instance_id,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 100,
        model_purpose: (input.model_purpose === "embedding" ? "embedding" : "chat") as import("../agent/agent.types.js").ModelPurpose,
        supported_modes: (input.supported_modes ?? ["once", "agent", "task"]) as import("../orchestration/types.js").ExecutionMode[],
        settings: input.settings || {},
        connection_id: input.connection_id,
      });
      await activate_provider(provider_store, agent_backends, provider_registry, workspace, input.instance_id, input.token || null);
      log.info("provider_create", { id: input.instance_id, provider_type: input.provider_type, connection_id: input.connection_id });
      return { ok: true };
    },

    async update(instance_id, patch) {
      const existing = provider_store.get(instance_id);
      if (!existing) return { ok: false, error: "not_found" };
      provider_store.update_settings(instance_id, {
        label: patch.label, enabled: patch.enabled, priority: patch.priority,
        model_purpose: patch.model_purpose as import("../agent/agent.types.js").ModelPurpose | undefined,
        supported_modes: patch.supported_modes as import("../orchestration/types.js").ExecutionMode[] | undefined,
        settings: patch.settings,
        connection_id: patch.connection_id,
      });
      if (patch.token !== undefined) {
        if (patch.token) await provider_store.set_token(instance_id, patch.token);
        else await provider_store.remove_token(instance_id);
      }
      const updated_config = provider_store.get(instance_id);
      if (updated_config) {
        const token = await provider_store.resolve_token(instance_id);
        const effective = apply_connection_api_base(provider_store, updated_config);
        const backend = create_agent_provider(effective, token, { provider_registry, workspace });
        if (backend) agent_backends.register(backend, effective);
      }
      log.info("provider_update", { id: instance_id, fields: Object.keys(patch) });
      return { ok: true };
    },

    async remove(instance_id) {
      await agent_backends.unregister(instance_id);
      await provider_store.remove_token(instance_id);
      const removed = provider_store.remove(instance_id);
      if (removed) log.info("provider_remove", { id: instance_id });
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_availability(instance_id) {
      const config = provider_store.get(instance_id);
      if (!config) return { ok: false, error: "instance_not_found" };
      const token = await provider_store.resolve_token(instance_id);
      const effective = apply_connection_api_base(provider_store, config);
      const backend = create_agent_provider(effective, token, { provider_registry, workspace });
      if (!backend) return { ok: false, error: "unknown_provider_type" };
      try {
        const available = backend.is_available();
        try { backend.stop?.(); } catch { /* best-effort */ }
        return { ok: available, detail: available ? "available" : "unavailable" };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },

    list_provider_types() {
      return list_registered_provider_types();
    },

    list_models: do_list_models,

    // ── Connection CRUD ──

    async list_connections() {
      const conns = provider_store.list_connections();
      return Promise.all(conns.map(build_connection_info));
    },

    async get_connection(connection_id) {
      const conn = provider_store.get_connection(connection_id);
      if (!conn) return null;
      return build_connection_info(conn);
    },

    async create_connection(input) {
      if (!input.connection_id || !input.provider_type) return { ok: false, error: "connection_id_and_provider_type_required" };
      if (provider_store.get_connection(input.connection_id)) return { ok: false, error: "connection_already_exists" };
      provider_store.upsert_connection({
        connection_id: input.connection_id,
        provider_type: input.provider_type,
        label: input.label || input.connection_id,
        enabled: input.enabled ?? true,
        api_base: input.api_base,
      });
      if (input.token) await provider_store.set_connection_token(input.connection_id, input.token);
      log.info("connection_create", { id: input.connection_id, provider_type: input.provider_type });
      return { ok: true };
    },

    async update_connection(connection_id, patch) {
      const existing = provider_store.get_connection(connection_id);
      if (!existing) return { ok: false, error: "not_found" };
      provider_store.update_connection(connection_id, {
        label: patch.label,
        enabled: patch.enabled,
        api_base: patch.api_base,
      });
      if (patch.token !== undefined) {
        if (patch.token) await provider_store.set_connection_token(connection_id, patch.token);
        else await provider_store.remove_connection_token(connection_id);
      }
      // connection이 변경되면 참조하는 모든 provider를 재활성화
      for (const config of provider_store.list()) {
        if (config.connection_id !== connection_id) continue;
        const token = await provider_store.resolve_token(config.instance_id);
        const effective = apply_connection_api_base(provider_store, config);
        const backend = create_agent_provider(effective, token, { provider_registry, workspace });
        if (backend) agent_backends.register(backend, effective);
      }
      log.info("connection_update", { id: connection_id, fields: Object.keys(patch) });
      return { ok: true };
    },

    async remove_connection(connection_id) {
      await provider_store.remove_connection_token(connection_id);
      const removed = provider_store.remove_connection(connection_id);
      if (removed) log.info("connection_remove", { id: connection_id });
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_connection(connection_id) {
      const conn = provider_store.get_connection(connection_id);
      if (!conn) return { ok: false, error: "connection_not_found" };
      const token = await provider_store.get_connection_token(connection_id);
      if (!token) return { ok: false, error: "token_not_configured" };
      // 연결 테스트: 해당 provider_type으로 모델 목록 조회 시도
      try {
        const models = await do_list_models(conn.provider_type, { api_key: token, api_base: conn.api_base });
        return { ok: true, detail: `${models.length} models available` };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
  };
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

export function create_bootstrap_ops(deps: {
  provider_store: AgentProviderStore;
  config_store: ConfigStore;
  provider_registry: ProviderRegistry;
  agent_backends: AgentBackendRegistry;
  workspace: string;
}): BootstrapOps {
  const { provider_store, config_store, provider_registry, agent_backends, workspace } = deps;
  return {
    get_status() {
      return { needed: provider_store.count() === 0, providers: list_registered_provider_types() };
    },
    async apply(input) {
      if (!Array.isArray(input.providers) || input.providers.length === 0) {
        return { ok: false, error: "at_least_one_provider_required" };
      }
      for (const p of input.providers) {
        if (!p.instance_id || !p.provider_type) return { ok: false, error: "instance_id_and_provider_type_required" };
        provider_store.upsert({
          instance_id: p.instance_id, provider_type: p.provider_type,
          label: p.label || p.instance_id, enabled: p.enabled ?? true,
          priority: p.priority ?? 100, model_purpose: "chat",
          supported_modes: ["once", "agent", "task"],
          settings: p.settings || {},
        });
        await activate_provider(provider_store, agent_backends, provider_registry, workspace, p.instance_id, p.token);
      }
      if (input.executor) await config_store.set_value("orchestration.executorProvider", input.executor);
      if (input.orchestrator) await config_store.set_value("orchestration.orchestratorProvider", input.orchestrator);
      if (input.alias) await config_store.set_value("channel.defaultAlias", input.alias);
      const templates_dir = join(workspace, "templates");
      mkdirSync(templates_dir, { recursive: true });
      for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
        const target = join(templates_dir, `${name}.md`);
        if (!existsSync(target)) writeFileSync(target, content, "utf-8");
      }
      if (input.persona_name) {
        const soul_path = join(templates_dir, "SOUL.md");
        try {
          let soul = readFileSync(soul_path, "utf-8");
          soul = soul.replace(
            /(-\s*이름\s*[:：]\s*).+/m,
            `$1**${input.persona_name}**`,
          );
          writeFileSync(soul_path, soul, "utf-8");
        } catch { /* SOUL.md 파싱 실패 — 첫 채팅 부트스트랩에서 재설정 */ }
      }
      return { ok: true };
    },
  };
}

// ─── Memory ────────────────────────────────────────────────────────────────

export function create_memory_ops(memory_store: MemoryStoreLike): DashboardMemoryOps {
  return {
    read_longterm: () => memory_store.read_longterm(),
    write_longterm: (content) => memory_store.write_longterm(content),
    list_daily: () => memory_store.list_daily(),
    read_daily: (day) => memory_store.read_daily(day),
    write_daily: (content, day) => memory_store.write_daily(content, day),
  };
}

// ─── Workspace ─────────────────────────────────────────────────────────────

export function create_workspace_ops(workspace_dir: string): DashboardWorkspaceOps {
  return {
    async list_files(rel_path = "") {
      const safe = sanitize_rel_path(rel_path);
      const abs = join(workspace_dir, safe);
      try {
        const entries = readdirSync(abs, { withFileTypes: true });
        return entries.map((e) => {
          const rel = safe ? `${safe}/${e.name}` : e.name;
          let size = 0; let mtime = 0;
          try { const st = statSync(join(abs, e.name)); size = st.size; mtime = st.mtimeMs; } catch { /* skip */ }
          return { name: e.name, rel, is_dir: e.isDirectory(), size, mtime };
        });
      } catch { return []; }
    },
    async read_file(rel_path) {
      const safe = sanitize_rel_path(rel_path);
      const abs = join(workspace_dir, safe);
      try { return readFileSync(abs, "utf-8"); } catch { return null; }
    },
  };
}

// ─── OAuth ─────────────────────────────────────────────────────────────────

export function create_oauth_ops(deps: {
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  dashboard_port: number;
  public_url?: string;
}): DashboardOAuthOps {
  const { oauth_store, oauth_flow, dashboard_port, public_url } = deps;
  const log = create_logger("oauth-ops");

  function resolve_origin(request_origin: string | undefined): string {
    if (public_url) return public_url.replace(/\/$/, "");
    return request_origin ?? `http://localhost:${dashboard_port}`;
  }

  async function build_info(config: import("../oauth/integration-store.js").OAuthIntegrationConfig): Promise<OAuthIntegrationInfo> {
    const has_token = await oauth_store.has_access_token(config.instance_id);
    const has_secret = await oauth_store.has_client_secret(config.instance_id);
    return {
      instance_id: config.instance_id, service_type: config.service_type,
      label: config.label, enabled: config.enabled, scopes: config.scopes,
      token_configured: has_token, expired: oauth_store.is_expired(config.instance_id),
      expires_at: config.expires_at, has_client_secret: has_secret,
      created_at: config.created_at, updated_at: config.updated_at,
    };
  }

  return {
    async list() { return Promise.all(oauth_store.list().map(build_info)); },
    async get(id) { const c = oauth_store.get(id); return c ? build_info(c) : null; },

    async create(input) {
      if (!input.service_type || !input.client_id) return { ok: false, error: "service_type_and_client_id_required" };
      const instance_id = input.label?.toLowerCase().replace(/\s+/g, "-") || input.service_type;
      if (oauth_store.get(instance_id)) return { ok: false, error: "instance_already_exists" };
      const preset = get_oauth_preset(input.service_type);
      const auth_url = input.auth_url || preset?.auth_url || "";
      const token_url = input.token_url || preset?.token_url || "";
      const redirect_uri = `${resolve_origin(undefined)}/api/oauth/callback`;
      oauth_store.upsert({
        instance_id, service_type: input.service_type,
        label: input.label || instance_id, enabled: true,
        scopes: input.scopes || preset?.default_scopes || [],
        auth_url, token_url, redirect_uri, settings: {},
      });
      await oauth_store.vault_store_client_id(instance_id, input.client_id);
      if (input.client_secret) await oauth_store.vault_store_client_secret(instance_id, input.client_secret);
      log.info("oauth_integration_create", { id: instance_id, service_type: input.service_type });
      return { ok: true, instance_id };
    },

    async update(id, patch) {
      if (!oauth_store.get(id)) return { ok: false, error: "not_found" };
      oauth_store.update_settings(id, patch);
      log.info("oauth_integration_update", { id, fields: Object.keys(patch) });
      return { ok: true };
    },

    async remove(id) {
      const existed = oauth_store.remove(id);
      if (!existed) return { ok: false, error: "not_found" };
      await oauth_store.remove_tokens(id);
      log.info("oauth_integration_remove", { id });
      return { ok: true };
    },

    async start_auth(id, client_secret, origin) {
      const integration = oauth_store.get(id);
      if (!integration) return { ok: false, error: "not_found" };
      const client_id = await oauth_store.get_client_id(id);
      if (!client_id) return { ok: false, error: "missing_client_id" };
      if (client_secret) await oauth_store.vault_store_client_secret(id, client_secret);
      const effective_origin = resolve_origin(origin);
      const redirect_uri = `${effective_origin}/api/oauth/callback`;
      if (integration.redirect_uri !== redirect_uri) oauth_store.upsert({ ...integration, redirect_uri });
      const updated = oauth_store.get(id) ?? integration;
      const auth_url = oauth_flow.generate_auth_url_with_client_id(updated, client_id);
      return { ok: true, auth_url };
    },

    async refresh(id) { return oauth_flow.refresh_token(id); },
    async test(id) { return oauth_flow.test_token(id); },
    list_presets() { return list_oauth_presets(); },

    async register_preset(preset) {
      if (!preset.service_type || !preset.auth_url || !preset.token_url) return { ok: false, error: "service_type, auth_url, token_url required" };
      oauth_flow.register_custom_preset({ scopes_available: [], default_scopes: [], supports_refresh: true, ...preset });
      return { ok: true };
    },

    async update_preset(service_type, patch) {
      const existing = get_oauth_preset(service_type);
      if (!existing) return { ok: false, error: "preset_not_found" };
      oauth_flow.register_custom_preset({ ...existing, ...patch });
      return { ok: true };
    },

    async unregister_preset(service_type) {
      const removed = oauth_flow.unregister_custom_preset(service_type);
      return removed ? { ok: true } : { ok: false, error: "preset_not_found_in_db" };
    },
  };
}

// ─── Config ─────────────────────────────────────────────────────────────────

export function create_config_ops(deps: {
  app_config: AppConfig;
  config_store: ConfigStore;
}): DashboardConfigOps {
  const { app_config, config_store } = deps;
  return {
    get_current_config: () => app_config as unknown as Record<string, unknown>,
    get_sections: async () => {
      const config_raw = app_config as unknown as Record<string, unknown>;
      const results = [];
      for (const id of SECTION_ORDER) {
        results.push({ id, label: SECTION_LABELS[id], fields: await config_store.get_section_status(id, config_raw) });
      }
      return results;
    },
    get_section: async (section: string) => {
      if (!SECTION_ORDER.includes(section as ConfigSection)) return null;
      const config_raw = app_config as unknown as Record<string, unknown>;
      return {
        id: section,
        label: SECTION_LABELS[section as ConfigSection],
        fields: await config_store.get_section_status(section as ConfigSection, config_raw),
      };
    },
    set_value: async (path: string, value: unknown) => {
      await config_store.set_value(path, value);
      set_nested(app_config as unknown as Record<string, unknown>, path, value);
    },
    remove_value: async (path: string) => {
      await config_store.remove_value(path);
      const fresh = get_config_defaults();
      const keys = path.split(".");
      let def: unknown = fresh as unknown as Record<string, unknown>;
      for (const k of keys) {
        if (def == null || typeof def !== "object") { def = undefined; break; }
        def = (def as Record<string, unknown>)[k];
      }
      set_nested(app_config as unknown as Record<string, unknown>, path, def);
    },
  };
}

// ─── Skills ─────────────────────────────────────────────────────────────────

/** skills_loader 어댑터 — get_skill_metadata/list_skills/refresh/suggest_skills_for_text 지원 */
export type SkillsLoaderLike = {
  list_skills(with_meta?: boolean): Array<Record<string, string>>;
  get_skill_metadata(name: string): Record<string, unknown> | null;
  refresh(): void;
  suggest_skills_for_text?(text: string, limit: number): unknown[];
};

export function create_skill_ops(deps: {
  skills_loader: SkillsLoaderLike;
  workspace: string;
}): DashboardSkillOps {
  const { skills_loader, workspace } = deps;
  return {
    list_skills: () => skills_loader.list_skills(),
    get_skill_detail: (name: string) => {
      const meta = skills_loader.get_skill_metadata(name);
      let content: string | null = null;
      let references: Array<{ name: string; content: string }> | null = null;
      if (meta?.path) {
        try { content = readFileSync(String(meta.path), "utf-8"); } catch { /* skip */ }
        const refs_dir = join(String(meta.path), "..", "references");
        if (existsSync(refs_dir)) {
          try {
            references = readdirSync(refs_dir)
              .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
              .map((f) => ({ name: f, content: readFileSync(join(refs_dir, f), "utf-8") }));
          } catch { /* skip */ }
        }
      }
      return { metadata: meta, content, references };
    },
    refresh: () => skills_loader.refresh(),
    write_skill_file: (name: string, file: string, content: string) => {
      try {
        const meta = skills_loader.get_skill_metadata(name);
        if (!meta?.path) return { ok: false, error: "skill_not_found" };
        if (String(meta.source ?? "").toLowerCase() === "builtin") return { ok: false, error: "builtin_readonly" };
        const safe_file = sanitize_filename(file);
        if (!safe_file) return { ok: false, error: "invalid_filename" };
        const skill_base = join(String(meta.path), "..");
        const target = safe_file === "SKILL.md"
          ? String(meta.path)
          : join(skill_base, "references", safe_file);
        if (!is_inside(skill_base, target)) return { ok: false, error: "path_traversal_blocked" };
        writeFileSync(target, content, "utf-8");
        skills_loader.refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
    upload_skill: (name: string, zip_buffer: Buffer) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AdmZip = require("adm-zip") as typeof import("adm-zip");
        const zip = new AdmZip(zip_buffer);
        const skill_dir = join(workspace, "skills", name);
        const entries = zip.getEntries();
        const top_dirs = new Set(entries.map((e: { entryName: string }) => e.entryName.split("/")[0]).filter(Boolean));
        const strip_prefix = top_dirs.size === 1 ? `${[...top_dirs][0]}/` : "";
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const rel = sanitize_rel_path(strip_prefix ? entry.entryName.replace(strip_prefix, "") : entry.entryName);
          if (!rel) continue;
          const target = join(skill_dir, rel);
          if (!is_inside(skill_dir, target)) continue;
          mkdirSync(join(target, ".."), { recursive: true });
          writeFileSync(target, entry.getData());
        }
        skills_loader.refresh();
        return { ok: true, path: skill_dir };
      } catch (e) {
        return { ok: false, path: "", error: error_message(e) };
      }
    },
  };
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export function create_tool_ops(deps: {
  tool_names: () => string[];
  get_definitions: () => Array<Record<string, unknown>>;
  mcp: McpClientManager;
}): DashboardToolOps {
  return {
    tool_names: deps.tool_names,
    get_definitions: deps.get_definitions,
    list_mcp_servers: () => deps.mcp.list_servers().map((s) => ({
      name: s.name, connected: s.connected,
      tools: s.tools.map((t) => t.name), error: s.error,
    })),
  };
}

// ─── CLI Auth ────────────────────────────────────────────────────────────────

import type { CliAuthService, CliType } from "../agent/cli-auth.service.js";

export function create_cli_auth_ops(deps: {
  cli_auth: CliAuthService;
}): DashboardCliAuthOps {
  const valid_cli = (s: string): CliType | null =>
    s === "claude" || s === "codex" || s === "gemini" ? s : null;

  return {
    get_status: () => deps.cli_auth.get_all_cached(),
    check: async (cli) => {
      const t = valid_cli(cli);
      if (!t) return { cli, authenticated: false, error: "invalid cli type" };
      return deps.cli_auth.check(t);
    },
    check_all: () => deps.cli_auth.check_all(),
    start_login: async (cli) => {
      const t = valid_cli(cli);
      if (!t) return { cli, state: "failed", error: "invalid cli type" };
      return deps.cli_auth.start_login(t);
    },
    cancel_login: (cli) => {
      const t = valid_cli(cli);
      if (!t) return { ok: false };
      return { ok: deps.cli_auth.cancel_login(t) };
    },
  };
}

// ─── Models ───────────────────────────────────────────────────────────────

export function create_model_ops(runtime: OrchestratorLlmRuntime): DashboardModelOps {
  return {
    list: () => runtime.list_models(),
    pull: (name) => runtime.pull_model_by_name(name),
    pull_stream: (name) => runtime.pull_model_stream(name),
    delete: (name) => runtime.delete_model(name),
    list_active: () => runtime.list_running(),
    get_runtime_status: () => runtime.health_check().then((s) => s as unknown as Record<string, unknown>),
    switch_model: (name) => runtime.switch_model(name).then((s) => s as unknown as Record<string, unknown>),
  };
}

// ─── Workflows ────────────────────────────────────────────────────────────

import type { PhaseWorkflowStoreLike } from "../agent/phase-workflow-store.js";
import type { SubagentRegistry } from "../agent/subagents.js";
import type { SkillsLoader } from "../agent/skills.service.js";
import type { DashboardWorkflowOps } from "./service.js";
import type { PhaseLoopRunOptions, WorkflowDefinition, ChannelSendRequest, ChannelResponse } from "../agent/phase-loop.types.js";
import {
  load_workflow_templates, load_workflow_template,
  substitute_variables, save_workflow_template,
  delete_workflow_template, parse_workflow_yaml, serialize_to_yaml,
} from "../orchestration/workflow-loader.js";
import { run_phase_loop } from "../agent/phase-loop-runner.js";
import { build_node_catalog } from "../agent/tools/workflow-catalog.js";
import { short_id } from "../utils/common.js";
import type { Logger } from "../logger.js";

const WORKFLOW_SCHEMA_REFERENCE = `## Full Workflow Definition Schema
\`\`\`
WorkflowDefinition {
  title: string,
  objective?: string,
  variables?: { [key]: string },       // runtime substitution: {{key}}

  // ── Node-based (preferred) ──
  nodes?: WorkflowNodeDefinition[],     // unified array (phase + orche nodes)

  // ── Legacy arrays (used when nodes[] absent) ──
  phases?: PhaseDefinition[],
  orche_nodes?: OrcheNodeRecord[],

  field_mappings?: FieldMapping[],
  tool_nodes?: ToolNodeDefinition[],
  skill_nodes?: SkillNodeDefinition[],
  trigger_nodes?: TriggerNodeRecord[],
  hitl_channel?: { channel_type: string, chat_id?: string },
}
\`\`\`

### PhaseDefinition (agent execution unit)
\`\`\`
{
  phase_id: string,
  title: string,
  mode?: "parallel" | "interactive" | "sequential_loop",  // default: parallel
  agents: [{
    agent_id: string,
    role: string,
    label: string,
    backend: string,           // provider instance_id from backends list
    model?: string,
    system_prompt: string,
    tools?: string[],          // tool_node ids
    max_turns?: number,
    filesystem_isolation?: "none" | "directory" | "worktree",
  }],
  critic?: {
    backend: string,
    model?: string,
    system_prompt: string,
    gate?: boolean,
    on_rejection?: "retry_all" | "retry_targeted" | "escalate" | "goto",
    goto_phase?: string,
    max_retries?: number,
  },
  failure_policy?: "fail_fast" | "best_effort" | "quorum",
  depends_on?: string[],       // phase_ids (fork-join)
  tools?: string[],            // tool_node ids bound to all agents
  skills?: string[],           // skill names
  loop_until?: string,         // sequential_loop exit condition
  max_loop_iterations?: number,
}
\`\`\`

### FieldMapping (connect node outputs to inputs)
\`\`\`
{ from_node: string, from_field: string, to_node: string, to_field: string }
\`\`\`
Example: { from_node: "fetch-1", from_field: "body.items[0].id", to_node: "set-2", to_field: "value" }

### TriggerNodeRecord
\`\`\`
{
  id: string,
  trigger_type: "cron" | "webhook" | "manual" | "channel_message",
  schedule?: string,           // cron expression (for cron)
  timezone?: string,
  webhook_path?: string,       // (for webhook)
  channel_type?: string,       // (for channel_message)
  chat_id?: string,
}
\`\`\`

### ToolNodeDefinition
\`\`\`
{ id: string, tool_id: string, description: string, attach_to?: string[] }
\`\`\`

### SkillNodeDefinition
\`\`\`
{ id: string, skill_name: string, description: string, attach_to?: string[] }
\`\`\``;

export function create_workflow_ops(deps: {
  store: PhaseWorkflowStoreLike;
  subagents: SubagentRegistry;
  workspace: string;
  logger: Logger;
  skills_loader?: SkillsLoader;
  on_workflow_event?: (event: import("../agent/phase-loop.types.js").PhaseLoopEvent) => void;
  bus?: import("../bus/types.js").MessageBusLike;
  cron?: import("../cron/service.js").CronService;
  /** Tool Invoke 노드용: 도구 실행 콜백. */
  invoke_tool?: (tool_id: string, params: Record<string, unknown>, context?: { workflow_id?: string; channel?: string; chat_id?: string; sender_id?: string }) => Promise<string>;
  /** LLM provider (llm, analyzer 노드용). */
  providers?: import("../providers/service.js").ProviderRegistry | null;
  /** suggest용: 등록된 도구 이름·설명 목록. */
  get_tool_summaries?: () => Array<{ name: string; description: string; category: string }>;
  /** suggest용: 사용 가능한 백엔드/모델 요약. */
  get_provider_summaries?: () => Array<{ backend: string; label: string; provider_type: string; models: string[] }>;
  /** Decision/Promise 서비스 (워크플로우 노드용). */
  decision_service?: import("../decision/service.js").DecisionService | null;
  promise_service?: import("../decision/promise.service.js").PromiseService | null;
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  on_kanban_trigger_waiting?: (workflow_id: string) => void;
  /** 공유 HITL pending store. */
  hitl_pending_store: import("../orchestration/hitl-pending-store.js").HitlPendingStore;
  /** 페르소나 메시지 렌더러. */
  renderer?: import("../channels/persona-message-renderer.js").PersonaMessageRendererLike | null;
}): DashboardWorkflowOps & { hitl_bridge: import("../channels/manager.js").WorkflowHitlBridge } {
  const { store, subagents, workspace, logger, skills_loader, on_workflow_event, bus, cron } = deps;
  let suggest_node_catalog_cache: string | null = null;

  const pending_responses = deps.hitl_pending_store;

  /** HITL ask_user 콜백 빌더. 항상 워크플로우 실행 채널/대화로 전송. */
  function build_ask_user(workflow_id: string, target_channel: string, target_chat_id: string) {
    return (question: string): Promise<string> => {
      on_workflow_event?.({ type: "user_input_requested", workflow_id, phase_id: "", question });

      if (bus && target_channel !== "dashboard" && target_channel !== "web") {
        const formatted = deps.renderer
          ? deps.renderer.render({ kind: "workflow_ask", question })
          : [
              "💬 **질문**", "", question, "",
              "질문에 대한 답변을 답장해주세요.", "",
              "_이 메시지에 답장하면 워크플로우가 자동으로 재개됩니다._",
            ].join("\n");
        bus.publish_outbound({
          id: `wf-ask-${short_id(8)}`, provider: target_channel, channel: target_channel,
          sender_id: "system", chat_id: target_chat_id, content: formatted,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_ask_user" },
        }).catch((e) => logger.error("workflow_ask_user_send_failed", { workflow_id, error: String(e) }));
      }

      return new Promise<string>((resolve) => {
        pending_responses.set(workflow_id, { resolve, chat_id: target_chat_id });
      });
    };
  }

  /** Interaction 노드용: 채널 메시지 전송 (fire-and-forget). */
  function build_send_message(workflow_id: string, origin_channel: string, origin_chat_id: string) {
    return async (req: ChannelSendRequest): Promise<{ ok: boolean; message_id?: string }> => {
      if (!bus) return { ok: false };
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);
      const msg_id = `wf-msg-${short_id(8)}`;
      try {
        await bus.publish_outbound({
          id: msg_id, provider: channel, channel,
          sender_id: "system", chat_id, content: req.content,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_notification", ...(req.structured ? { structured: req.structured } : {}) },
        });
        return { ok: true, message_id: msg_id };
      } catch (e) {
        logger.error("workflow_send_message_failed", { workflow_id, error: String(e) });
        return { ok: false };
      }
    };
  }

  /** Interaction 노드용: 채널 질문 전송 + 응답 대기. */
  function build_ask_channel(workflow_id: string, origin_channel: string, origin_chat_id: string) {
    return (req: ChannelSendRequest, timeout_ms: number): Promise<ChannelResponse> => {
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);

      if (bus && channel !== "dashboard" && channel !== "web") {
        bus.publish_outbound({
          id: `wf-ask-${short_id(8)}`, provider: channel, channel,
          sender_id: "system", chat_id, content: req.content,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_ask_channel", ...(req.structured ? { structured: req.structured } : {}) },
        }).catch((e) => logger.error("workflow_ask_channel_send_failed", { workflow_id, error: String(e) }));
      }

      return new Promise<ChannelResponse>((resolve) => {
        const timer = setTimeout(() => {
          pending_responses.delete(workflow_id);
          resolve({
            response: "", responded_at: new Date().toISOString(), timed_out: true,
          });
        }, timeout_ms);

        pending_responses.set(workflow_id, {
          resolve: (content: string) => {
            clearTimeout(timer);
            resolve({
              response: content,
              responded_by: { channel, chat_id: chat_id },
              responded_at: new Date().toISOString(),
              timed_out: false,
            });
          },
          chat_id,
        });
      });
    };
  }

  /** chat_id로 활성 워크플로우 HITL 응답 시도. */
  const hitl_bridge: import("../channels/manager.js").WorkflowHitlBridge = {
    async try_resolve(chat_id: string, content: string): Promise<boolean> {
      return pending_responses.try_resolve(chat_id, content);
    },
  };

  return {
    hitl_bridge,
    list: () => store.list(),
    get: (id) => store.get(id),

    async create(input) {
      const title = String(input.title || "Untitled Workflow");
      const objective = String(input.objective || "");
      const channel = String(input.channel || "dashboard");
      const chat_id = String(input.chat_id || "web");

      let phases: PhaseLoopRunOptions["phases"];
      let nodes: PhaseLoopRunOptions["nodes"];
      let field_mappings: PhaseLoopRunOptions["field_mappings"];
      if (input.template_name) {
        const template = load_workflow_templates(workspace)
          .find((t) => t.title.toLowerCase().includes(String(input.template_name).toLowerCase()));
        if (!template) return { ok: false, error: "template_not_found" };
        const user_vars = input.variables && typeof input.variables === "object"
          ? Object.fromEntries(Object.entries(input.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : {};
        const substituted = substitute_variables(template, { ...(template.variables || {}), ...user_vars, objective, channel });
        phases = substituted.phases;
        nodes = substituted.nodes;
        field_mappings = substituted.field_mappings;
      } else if (Array.isArray(input.nodes)) {
        nodes = input.nodes as PhaseLoopRunOptions["nodes"];
        phases = Array.isArray(input.phases) ? input.phases as PhaseLoopRunOptions["phases"] : [];
        field_mappings = Array.isArray(input.field_mappings) ? input.field_mappings as PhaseLoopRunOptions["field_mappings"] : undefined;
      } else if (Array.isArray(input.phases)) {
        phases = input.phases as PhaseLoopRunOptions["phases"];
        field_mappings = Array.isArray(input.field_mappings) ? input.field_mappings as PhaseLoopRunOptions["field_mappings"] : undefined;
      } else {
        // objective만 있으면 기본 파이프라인 템플릿으로 폴백
        const fallback = load_workflow_template(workspace, "autonomous-dev-pipeline")
          || load_workflow_templates(workspace)[0];
        if (!fallback) return { ok: false, error: "no_default_template" };
        const substituted = substitute_variables(fallback, { ...(fallback.variables || {}), objective, channel });
        phases = substituted.phases;
        nodes = substituted.nodes;
        field_mappings = substituted.field_mappings;
      }

      // orche_nodes → nodes 병합: UI에서 추가한 오케스트레이션 노드를 실행 가능한 nodes 배열에 통합
      if (Array.isArray(input.orche_nodes) && input.orche_nodes.length) {
        const orche_as_nodes = (input.orche_nodes as Array<Record<string, unknown>>).map((n) => ({
          ...n,
          node_id: String(n.node_id),
          node_type: String(n.node_type),
          title: String(n.title || n.node_id || ""),
          depends_on: Array.isArray(n.depends_on) ? n.depends_on.map(String) : undefined,
        }));
        nodes = [...(nodes || []), ...orche_as_nodes] as PhaseLoopRunOptions["nodes"];
      }

      const workflow_id = `wf-${short_id(12)}`;

      const ask_user = build_ask_user(workflow_id, channel, chat_id);

      const origin = { channel, chat_id, sender_id: String(input.sender_id || "") };

      // 비동기 실행 (즉시 반환)
      void run_phase_loop({
        workflow_id, title, objective, channel, chat_id, phases, nodes, ask_user,
        send_message: build_send_message(workflow_id, channel, chat_id),
        ask_channel: build_ask_channel(workflow_id, channel, chat_id),
        invoke_tool: deps.invoke_tool,
        initial_memory: { origin },
        workspace,
        field_mappings,
      }, { subagents, store, logger, load_template: (name) => load_workflow_template(workspace, name), providers: deps.providers, decision_service: deps.decision_service, promise_service: deps.promise_service, embed: deps.embed, vector_store: deps.vector_store, oauth_fetch: deps.oauth_fetch, get_webhook_data: deps.get_webhook_data, wait_kanban_event: deps.wait_kanban_event, create_task: deps.create_task, query_db: deps.query_db, on_kanban_trigger_waiting: deps.on_kanban_trigger_waiting, on_event: on_workflow_event }).catch((err) => {
        logger.error("workflow_create_run_error", { workflow_id, error: String(err) });
      });

      return { ok: true, workflow_id };
    },

    async cancel(workflow_id) {
      const state = await store.get(workflow_id);
      if (!state) return false;
      state.status = "cancelled";
      await store.upsert(state);
      subagents.cancel_by_parent_id(`workflow:${workflow_id}`);
      return true;
    },

    get_messages: (wid, pid, aid) => store.get_messages(wid, pid, aid),

    async send_message(workflow_id, phase_id, agent_id, content) {
      if (!content.trim()) return { ok: false, error: "empty_content" };
      const state = await store.get(workflow_id);
      if (!state) return { ok: false, error: "workflow_not_found" };

      const phase = state.phases.find((p) => p.phase_id === phase_id);
      if (!phase) return { ok: false, error: "phase_not_found" };
      const agent = phase.agents.find((a) => a.agent_id === agent_id);
      if (!agent) return { ok: false, error: "agent_not_found" };

      // 메시지 기록
      const msg = { role: "user" as const, content, at: new Date().toISOString() };
      await store.insert_message(workflow_id, phase_id, agent_id, msg);

      // HITL: pending response가 있으면 resolve하여 워크플로우 재개
      const entry = pending_responses.get(workflow_id);
      if (entry) {
        pending_responses.delete(workflow_id);
        entry.resolve(content);
        return { ok: true };
      }

      // 실행 중인 에이전트에 메시지 전달
      if (agent.subagent_id) {
        try {
          const accepted = subagents.send_input(agent.subagent_id, content);
          if (!accepted) return { ok: false, error: "agent_not_accepting_input" };
          return { ok: true };
        } catch {
          return { ok: false, error: "agent_not_accepting_input" };
        }
      }

      return { ok: false, error: "agent_has_no_input_channel" };
    },

    list_templates: () => load_workflow_templates(workspace),

    get_template: (name) => load_workflow_template(workspace, name),

    save_template(name, definition) {
      const slug = save_workflow_template(workspace, name, definition);
      // trigger가 cron이면 cron 서비스에 등록
      if (cron && definition.trigger?.type === "cron" && definition.trigger.schedule) {
        const cron_name = `workflow:${slug}`;
        // 기존 동명 cron job 제거 후 재등록
        cron.list_jobs(true).then((jobs) => {
          const existing = jobs.find((j) => j.name === cron_name);
          if (existing) return cron.remove_job(existing.id);
        }).then(() =>
          cron.add_job(cron_name, {
            kind: "cron", expr: definition.trigger!.schedule,
            tz: definition.trigger!.timezone ?? null,
            at_ms: null, every_ms: null,
          }, `workflow_trigger:${slug}`, false, null, null, false),
        ).catch((e) => logger.warn("workflow_cron_register_failed", { slug, error: String(e) }));
      }
      return slug;
    },

    delete_template(name) {
      const removed = delete_workflow_template(workspace, name);
      // cron trigger도 제거
      if (cron && removed) {
        const cron_name = `workflow:${name}`;
        cron.list_jobs(true).then((jobs) => {
          const existing = jobs.find((j) => j.name === cron_name);
          if (existing) return cron.remove_job(existing.id);
        }).catch((e) => logger.warn("workflow_cron_unregister_failed", { name, error: String(e) }));
      }
      return removed;
    },

    import_template(yaml_content) {
      const def = parse_workflow_yaml(yaml_content);
      if (!def) return { ok: false, error: "invalid_yaml" };
      const slug = save_workflow_template(workspace, def.title || "imported", def);
      return { ok: true, name: slug };
    },

    export_template(name) {
      const def = load_workflow_template(workspace, name);
      if (!def) return null;
      return serialize_to_yaml(def);
    },

    list_roles() {
      if (!skills_loader) return [];
      return skills_loader.list_role_skills().map((m) => ({
        id: m.role || m.name,
        name: m.name.replace(/^role:/, ""),
        description: m.summary,
        soul: m.soul,
        heart: m.heart,
        tools: m.tools,
      }));
    },

    async resume(workflow_id) {
      const state = await store.get(workflow_id);
      if (!state) return { ok: false, error: "workflow_not_found" };
      if (state.status === "completed" || state.status === "cancelled") {
        return { ok: false, error: `workflow_already_${state.status}` };
      }
      if (state.status === "running") {
        return { ok: false, error: "workflow_already_running" };
      }

      // definition이 없으면 재실행 불가
      if (!state.definition?.phases?.length && !state.definition?.nodes?.length) {
        return { ok: false, error: "no_definition_for_resume" };
      }

      const { channel, chat_id } = state;
      const ask_user = build_ask_user(workflow_id, channel, chat_id);

      // 기존 state를 resume_state로 전달 → runner가 완료된 노드를 skip하고 이어서 실행
      void run_phase_loop({
        workflow_id, title: state.title, objective: state.objective,
        channel, chat_id,
        phases: state.definition.phases || [],
        nodes: state.definition.nodes,
        field_mappings: state.definition.field_mappings,
        ask_user,
        send_message: build_send_message(workflow_id, channel, chat_id),
        ask_channel: build_ask_channel(workflow_id, channel, chat_id),
        invoke_tool: deps.invoke_tool,
        workspace,
        initial_memory: state.memory,
        resume_state: state,
      }, { subagents, store, logger, load_template: (name) => load_workflow_template(workspace, name), providers: deps.providers, decision_service: deps.decision_service, promise_service: deps.promise_service, embed: deps.embed, vector_store: deps.vector_store, oauth_fetch: deps.oauth_fetch, get_webhook_data: deps.get_webhook_data, wait_kanban_event: deps.wait_kanban_event, create_task: deps.create_task, query_db: deps.query_db, on_kanban_trigger_waiting: deps.on_kanban_trigger_waiting, on_event: on_workflow_event }).catch((err) => {
        logger.error("workflow_resume_run_error", { workflow_id, error: String(err) });
      });

      return { ok: true };
    },

    async run_single_node(node_raw, input_memory) {
      const { is_orche_node: is_orche } = await import("../agent/workflow-node.types.js");
      const { execute_orche_node } = await import("../agent/orche-node-executor.js");
      const node = node_raw as unknown as import("../agent/workflow-node.types.js").WorkflowNodeDefinition;
      const start = Date.now();
      logger.info("run_single_node", { node_type: node.node_type, node_id: (node as unknown as Record<string, unknown>).node_id, is_orche: is_orche(node), mem_keys: Object.keys(input_memory) });

      if (is_orche(node)) {
        try {
          const result = await execute_orche_node(node, { memory: { ...input_memory }, workspace });
          return { ok: true, output: result.output, duration_ms: Date.now() - start };
        } catch (err) {
          return { ok: false, error: String(err), duration_ms: Date.now() - start };
        }
      }

      // Phase(Agent) 노드: subagent spawn → LLM 호출
      if (node.node_type === "phase") {
        const agent_def = node.agents?.[0];
        if (!agent_def) return { ok: false, error: "no_agents_in_phase" };

        const task_parts = [agent_def.system_prompt || ""];
        if (Object.keys(input_memory).length) {
          task_parts.push(`\n## Context\n${JSON.stringify(input_memory, null, 2)}`);
        }
        task_parts.push(`\n## Objective\nExecute this phase node independently.`);

        try {
          const { subagent_id } = await subagents.spawn({
            task: task_parts.join("\n"),
            role: agent_def.role,
            label: agent_def.label || node.title,
            provider_id: (agent_def.backend || undefined) as import("../providers/types.js").ProviderId | undefined,
            model: agent_def.model,
            max_iterations: agent_def.max_turns || 5,
            announce: false,
            skip_controller: true,
          });
          const result = await subagents.wait_for_completion(subagent_id, 3 * 60_000);
          if (!result) return { ok: false, error: "subagent_not_found", duration_ms: Date.now() - start };
          if (result.status === "failed") return { ok: false, error: result.error || "subagent_failed", duration_ms: Date.now() - start };
          // 에이전트가 구조화된 JSON으로 응답한 경우 객체로 반환
          const raw = result.content || "";
          let output: unknown = raw;
          if (typeof raw === "string") {
            const trimmed = raw.trim();
            // 1) 직접 파싱
            try { output = JSON.parse(trimmed); } catch {
              // 2) ```json ... ``` 코드블록 내 JSON 추출
              const cb = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
              if (cb?.[1]) {
                try { output = JSON.parse(cb[1].trim()); } catch { /* fall through */ }
              }
              // 3) 본문 내 첫 번째 JSON 블록 추출
              if (output === raw) {
                const braceIdx = trimmed.indexOf("{");
                const bracketIdx = trimmed.indexOf("[");
                const idx = braceIdx >= 0 && (bracketIdx < 0 || braceIdx < bracketIdx) ? braceIdx : bracketIdx;
                if (idx >= 0) {
                  try { output = JSON.parse(trimmed.slice(idx)); } catch { /* 평문 유지 */ }
                }
              }
            }
          }
          return { ok: true, output, duration_ms: Date.now() - start };
        } catch (err) {
          return { ok: false, error: String(err), duration_ms: Date.now() - start };
        }
      }

      return { ok: false, error: "unknown_node_type" };
    },

    async suggest(instruction, workflow) {
      if (!deps.providers) return { ok: false, error: "providers_not_configured" };
      try {
        if (!suggest_node_catalog_cache) suggest_node_catalog_cache = build_node_catalog();
        const node_catalog = suggest_node_catalog_cache;

        const tool_section = deps.get_tool_summaries
          ? deps.get_tool_summaries()
              .map((t) => `- ${t.name} [${t.category}]: ${t.description}`)
              .join("\n")
          : "";

        const provider_section = deps.get_provider_summaries
          ? deps.get_provider_summaries()
              .map((p) => `- ${p.backend} (${p.provider_type}): ${p.models.join(", ") || "(no models)"}`)
              .join("\n")
          : "";

        const skill_section = skills_loader
          ? skills_loader.list_skills(true).map((s) => `- ${s.name}: ${s.summary}`).join("\n")
          : "";

        const system = [
          "You are a workflow editor agent. You receive a workflow definition (JSON) and an edit instruction from the user.",
          "Return ONLY the modified workflow definition as valid JSON — no markdown fences, no explanation.",
          "Preserve all existing fields unless the instruction explicitly asks to change them.",
          "If the instruction is unclear or impossible, return the original workflow unchanged.",
          "",
          node_catalog,
          "",
          WORKFLOW_SCHEMA_REFERENCE,
          tool_section ? `\n## Available Tools (for tool_invoke / tool_nodes)\n${tool_section}` : "",
          provider_section ? `\n## Available Backends & Models (for ai_agent/llm nodes)\n${provider_section}` : "",
          skill_section ? `\n## Available Skills (for skill_nodes / phase skills)\n${skill_section}` : "",
        ].filter(Boolean).join("\n");
        const prompt = [
          "## Current Workflow",
          JSON.stringify(workflow, null, 2),
          "",
          "## Instruction",
          instruction,
        ].join("\n");
        const res = await deps.providers.run_headless_prompt({ prompt, system, max_tokens: 8192, temperature: 0.2 });
        const raw = String(res.content || "").trim();
        // JSON 추출: 직접 파싱 → ```json 블록 → 첫 { 부터
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw); } catch {
          const cb = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
          if (cb?.[1]) { try { parsed = JSON.parse(cb[1].trim()); } catch { /* */ } }
          if (!parsed) {
            const idx = raw.indexOf("{");
            if (idx >= 0) { try { parsed = JSON.parse(raw.slice(idx)); } catch { /* */ } }
          }
        }
        if (!parsed || typeof parsed !== "object") return { ok: false, error: "llm_returned_invalid_json" };
        return { ok: true, workflow: parsed };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    test_single_node(node_raw, input_memory) {
      const node = node_raw as unknown as import("../agent/workflow-node.types.js").WorkflowNodeDefinition;

      if (node.node_type !== "phase") {
        // 동적 import 대신 sync 접근 (test는 동기 함수)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { test_orche_node } = require("../agent/orche-node-executor.js") as typeof import("../agent/orche-node-executor.js");
        if (!workspace) throw new Error("workspace is required for test_single_node");
        const result = test_orche_node(node as import("../agent/workflow-node.types.js").OrcheNodeDefinition, { memory: { ...input_memory }, workspace });
        return { ok: true, preview: result.preview, warnings: result.warnings };
      }

      // Phase(Agent) 노드: 프롬프트 미리보기
      const agent_def = node.agents?.[0];
      if (!agent_def) return { ok: false, warnings: ["no_agents_in_phase"] };
      const prompt_preview = [
        agent_def.system_prompt || "(empty system_prompt)",
        Object.keys(input_memory).length ? `\n## Context\n${JSON.stringify(input_memory, null, 2)}` : "",
        `\n## Objective\n(will be provided at runtime)`,
      ].join("\n");
      return { ok: true, preview: { prompt: prompt_preview, backend: agent_def.backend, model: agent_def.model }, warnings: [] };
    },
  };
}
