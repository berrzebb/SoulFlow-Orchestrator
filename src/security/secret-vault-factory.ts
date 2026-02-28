import { resolve } from "node:path";
import { SecretVaultService } from "./secret-vault.js";

const shared_vaults = new Map<string, SecretVaultService>();

export function get_shared_secret_vault(workspace: string): SecretVaultService {
  const key = resolve(String(workspace || process.cwd()));
  const existing = shared_vaults.get(key);
  if (existing) return existing;
  const created = new SecretVaultService(key);
  shared_vaults.set(key, created);
  return created;
}

