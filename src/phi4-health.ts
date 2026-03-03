import { join } from "node:path";
import { Phi4RuntimeManager } from "./providers/index.js";
import { ConfigStore } from "./config/config-store.js";
import { get_shared_secret_vault } from "./security/secret-vault-factory.js";
import { load_config_merged } from "./config/schema.js";

async function main(): Promise<void> {
  const workspace = process.cwd();
  const bootstrap_data_dir = join(workspace, "runtime");
  const shared_vault = get_shared_secret_vault(workspace);
  const config_store = new ConfigStore(join(bootstrap_data_dir, "config", "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);

  const manager = new Phi4RuntimeManager({
    enabled: true,
    engine: app_config.phi4.engine,
    image: app_config.phi4.image,
    container: app_config.phi4.container,
    port: app_config.phi4.port,
    model: app_config.phi4.model,
    pull_model: false,
    auto_stop: false,
    api_base: app_config.phi4.apiBase,
  });

  const status = await manager.health_check();

  process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  if (!status.running) process.exit(1);
  if (status.model_loaded === false) process.exit(2);
}

void main().catch((error) => {

  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(9);
});
