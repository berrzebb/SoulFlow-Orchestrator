import { loadConfig } from "./config/index.js";
import { load_config_from_env } from "./config/schema.js";
import { Phi4RuntimeManager } from "./providers/index.js";

async function main(): Promise<void> {
  const config = loadConfig(load_config_from_env());
  const manager = new Phi4RuntimeManager({
    enabled: true,
    engine: config.phi4RuntimeEngine,
    image: config.phi4RuntimeImage,
    container: config.phi4RuntimeContainer,
    port: config.phi4RuntimePort,
    model: config.phi4RuntimeModel,
    pull_model: false,
    auto_stop: false,
    api_base: process.env.PHI4_API_BASE || `http://127.0.0.1:${config.phi4RuntimePort}/v1`,
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

