/** Config 초기화 bundle. */

import { join } from "node:path";
import { ConfigStore } from "../config/config-store.js";
import { load_config_merged, type AppConfig } from "../config/schema.js";
import { get_shared_secret_vault, set_default_vault_workspace } from "../security/secret-vault-factory.js";
import { init_log_level } from "../logger.js";
import type { SecretVaultService } from "../security/secret-vault.js";

export interface ConfigBundle {
  shared_vault: SecretVaultService;
  config_store: ConfigStore;
  app_config: AppConfig;
}

export async function create_config_bundle(workspace: string, user_dir?: string): Promise<ConfigBundle> {
  const runtime_root = user_dir ?? workspace;
  set_default_vault_workspace(runtime_root);

  const bootstrap_data_dir = join(runtime_root, "runtime");
  const shared_vault = get_shared_secret_vault(runtime_root);
  const config_store = new ConfigStore(join(bootstrap_data_dir, "config", "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);

  init_log_level(app_config.logging.level);

  return { shared_vault, config_store, app_config };
}
