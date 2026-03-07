/** Dashboard bootstrap ops. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TEMPLATES } from "../../bootstrap-templates.js";
import { activate_provider } from "./shared.js";
import type { BootstrapOps } from "../service.js";
import type { AgentBackendRegistry } from "../../agent/agent-registry.js";
import type { AgentProviderStore } from "../../agent/provider-store.js";
import type { ProviderRegistry } from "../../providers/index.js";
import type { ConfigStore } from "../../config/config-store.js";
import { list_registered_provider_types } from "../../agent/provider-factory.js";

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
