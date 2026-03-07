/** Dashboard ops 공유 helper. */

import { resolve } from "node:path";
import type { AgentProviderStore } from "../../agent/provider-store.js";
import type { AgentBackendRegistry } from "../../agent/agent-registry.js";
import type { ProviderRegistry } from "../../providers/index.js";
import { create_agent_provider } from "../../agent/provider-factory.js";

/** connection의 api_base를 settings에 머지한 config를 반환. */
export function apply_connection_api_base(store: AgentProviderStore, config: import("../../agent/agent.types.js").AgentProviderConfig): import("../../agent/agent.types.js").AgentProviderConfig {
  const resolved = store.resolve_api_base(config.instance_id);
  if (resolved && resolved !== config.settings.api_base) {
    return { ...config, settings: { ...config.settings, api_base: resolved } };
  }
  return config;
}

/** workspace 내부 상대 경로 sanitize. 디렉토리 탈출 방지. */
export function sanitize_rel_path(rel_path: string): string {
  return rel_path.replace(/\.\./g, "").replace(/^[/\\]+/, "");
}

/** 파일명만 허용 (경로 구분자 금지). */
export function sanitize_filename(name: string): string {
  return name.replace(/[\\/]/g, "").replace(/\.\./g, "");
}

/** resolve 결과가 base 디렉토리 내부인지 검증. */
export function is_inside(base: string, target: string): boolean {
  const norm_base = resolve(base).toLowerCase();
  const norm_target = resolve(target).toLowerCase();
  return norm_target === norm_base || norm_target.startsWith(`${norm_base}/`) || norm_target.startsWith(`${norm_base}\\`);
}

/** 프로바이더 저장 → 토큰 설정 → 백엔드 등록을 한 번에 수행. */
export async function activate_provider(
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
