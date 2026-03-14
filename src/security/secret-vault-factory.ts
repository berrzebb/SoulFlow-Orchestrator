import { resolve } from "node:path";
import type { SecretVaultLike } from "./secret-vault.js";
import { SecretVaultService } from "./secret-vault.js";

const shared_vaults = new Map<string, SecretVaultLike>();
let default_workspace: string | null = null;

/** 런타임 시작 시 한번 호출. 이후 get_shared_secret_vault() 인자 없이 사용 가능. */
export function set_default_vault_workspace(workspace: string): void {
  if (!workspace) throw new Error("workspace is required for set_default_vault_workspace");
  default_workspace = resolve(workspace);
}

/** workspace 기반 공유 SecretVaultLike 인스턴스. workspace 미지정 시 default 사용. */
export function get_shared_secret_vault(workspace?: string): SecretVaultLike {
  const ws = workspace ? resolve(String(workspace)) : default_workspace;
  if (!ws) throw new Error("workspace not set: call set_default_vault_workspace() first or pass workspace argument");
  const existing = shared_vaults.get(ws);
  if (existing) return existing;
  const created = new SecretVaultService(ws);
  shared_vaults.set(ws, created);
  return created;
}
