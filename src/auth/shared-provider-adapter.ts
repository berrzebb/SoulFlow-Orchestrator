/**
 * SharedProviderAdapter — admin.db의 공유 프로바이더를 AgentProviderConfig 형식으로 변환.
 * ProviderRegistry가 개인 프로바이더와 공유 프로바이더를 동일한 인터페이스로 소비할 수 있게 한다.
 *
 * 공유 프로바이더의 API 키는 admin vault에만 저장되며, 사용자에게 직접 노출되지 않는다.
 */

import type { AdminStore } from "./admin-store.js";
import type { SharedProviderRecord } from "./admin-store.js";
import type { AgentProviderConfig } from "../agent/agent.types.js";
import type { SecretVaultLike } from "../security/secret-vault.js";

/** 공유 프로바이더임을 나타내는 instance_id 접두사. */
const SHARED_PREFIX = "shared:";

/** 공유 프로바이더 우선순위 (개인 프로바이더보다 낮음 — 숫자가 클수록 낮은 우선순위). */
const SHARED_PRIORITY = 1000;

function to_provider_config(sp: SharedProviderRecord): AgentProviderConfig {
  return {
    instance_id: `${SHARED_PREFIX}${sp.id}`,
    provider_type: sp.type,
    label: sp.name,
    enabled: sp.enabled,
    priority: SHARED_PRIORITY,
    model_purpose: "chat",
    supported_modes: [],            // 모든 모드 허용
    settings: { ...sp.config, model: sp.model },
    connection_id: undefined,
    created_at: sp.created_at,
    updated_at: sp.created_at,
  };
}

export class SharedProviderAdapter {
  private readonly store: AdminStore;
  private readonly vault: SecretVaultLike;

  constructor(store: AdminStore, vault: SecretVaultLike) {
    this.store = store;
    this.vault = vault;
  }

  /** 활성 공유 프로바이더를 AgentProviderConfig 목록으로 반환. */
  list(): AgentProviderConfig[] {
    return this.store.list_shared_providers(true).map(to_provider_config);
  }

  /**
   * 공유 프로바이더 instance_id로 API 키 조회.
   * 비공유 instance_id는 null 반환.
   */
  async get_api_key(instance_id: string): Promise<string | null> {
    if (!instance_id.startsWith(SHARED_PREFIX)) return null;
    const sp_id = instance_id.slice(SHARED_PREFIX.length);
    const sp = this.store.get_shared_provider(sp_id);
    if (!sp || !sp.api_key_ref) return null;
    return this.vault.reveal_secret(sp.api_key_ref);
  }

  /** 주어진 instance_id가 공유 프로바이더인지 확인. */
  static is_shared(instance_id: string): boolean {
    return instance_id.startsWith(SHARED_PREFIX);
  }
}
