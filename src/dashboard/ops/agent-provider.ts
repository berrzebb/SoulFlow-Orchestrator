/** Dashboard agent provider ops. */

import { error_message } from "../../utils/common.js";
import { create_logger } from "../../logger.js";
import { create_agent_provider, list_registered_provider_types } from "../../agent/provider-factory.js";
import {
  fetch_openrouter_models, fetch_openai_models, fetch_anthropic_models,
  fetch_gemini_models, get_static_openai_models,
} from "../../services/model-catalog.js";
import { activate_provider, apply_connection_api_base } from "./shared.js";
import type { DashboardAgentProviderOps, ProviderConnectionInfo } from "../service.js";
import type { AgentBackendRegistry } from "../../agent/agent-registry.js";
import type { AgentProviderStore } from "../../agent/provider-store.js";
import type { ProviderRegistry } from "../../providers/index.js";

export function create_agent_provider_ops(deps: {
  provider_store: AgentProviderStore;
  agent_backends: AgentBackendRegistry;
  provider_registry: ProviderRegistry;
  workspace: string;
}): DashboardAgentProviderOps {
  const { provider_store, agent_backends, provider_registry, workspace } = deps;
  const log = create_logger("provider-ops");

  async function build_connection_info(conn: import("../../agent/agent.types.js").ProviderConnection): Promise<ProviderConnectionInfo> {
    const has_token = await provider_store.has_connection_token(conn.connection_id);
    const preset_count = provider_store.count_presets_for_connection(conn.connection_id);
    return { ...conn, token_configured: has_token, preset_count };
  }

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
      case "ollama": {
        // vLLM/Ollama 모두 OpenAI 호환 /v1/models 사용
        const models = await fetch_openai_models(api_base || "http://ollama:11434/v1");
        return models.map((m) => ({ ...m, provider: "ollama" as const }));
      }
      case "container_cli": {
        const [a, g, o] = await Promise.all([fetch_anthropic_models(), fetch_gemini_models(), Promise.resolve(get_static_openai_models())]);
        return [...a, ...g, ...o];
      }
      default:
        if (api_base) return fetch_openai_models(api_base);
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
        model_purpose: (input.model_purpose === "embedding" ? "embedding" : "chat") as import("../../agent/agent.types.js").ModelPurpose,
        supported_modes: (input.supported_modes ?? ["once", "agent", "task"]) as import("../../orchestration/types.js").ExecutionMode[],
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
        model_purpose: patch.model_purpose as import("../../agent/agent.types.js").ModelPurpose | undefined,
        supported_modes: patch.supported_modes as import("../../orchestration/types.js").ExecutionMode[] | undefined,
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
      // 토큰 불필요 프로바이더 (로컬 서버 등)는 토큰 체크 생략
      const TOKEN_OPTIONAL = new Set(["ollama", "container_cli"]);
      if (!TOKEN_OPTIONAL.has(conn.provider_type) && !token) {
        return { ok: false, error: "token_not_configured" };
      }
      try {
        const models = await do_list_models(conn.provider_type, { api_key: token ?? undefined, api_base: conn.api_base });
        return { ok: true, detail: `${models.length} models available` };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
  };
}
