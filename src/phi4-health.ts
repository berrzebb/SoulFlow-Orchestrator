import { loadConfig } from "./config/index.js";
import { Phi4RuntimeManager } from "./providers/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
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
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(status, null, 2));
  if (!status.running) process.exit(1);
  if (status.model_loaded === false) process.exit(2);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(9);
});

