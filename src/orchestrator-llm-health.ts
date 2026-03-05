import { error_message } from "./utils/common.js";
import { join } from "node:path";
import { OrchestratorLlmRuntime } from "./providers/index.js";
import { ConfigStore } from "./config/config-store.js";
import { get_shared_secret_vault } from "./security/secret-vault-factory.js";
import { load_config_merged } from "./config/schema.js";

async function main(): Promise<void> {
  const workspace = process.cwd();
  const bootstrap_data_dir = join(workspace, "runtime");
  const shared_vault = get_shared_secret_vault(workspace);
  const config_store = new ConfigStore(join(bootstrap_data_dir, "config", "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);

  const manager = new OrchestratorLlmRuntime({
    enabled: true,
    engine: app_config.orchestratorLlm.engine,
    image: app_config.orchestratorLlm.image,
    container: app_config.orchestratorLlm.container,
    port: app_config.orchestratorLlm.port,
    model: app_config.orchestratorLlm.model,
    pull_model: false,
    auto_stop: false,
    api_base: app_config.orchestratorLlm.apiBase,
  });

  const status = await manager.health_check();

  process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  if (!status.running) process.exit(1);
  if (status.model_loaded === false) process.exit(2);
}

void main().catch((error) => {

  process.stderr.write((error_message(error)) + "\n");
  process.exit(9);
});
