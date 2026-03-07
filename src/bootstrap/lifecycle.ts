/** Graceful shutdown lifecycle. */

import { error_message } from "../utils/common.js";
import type { RuntimeApp } from "../main.js";
import type { Logger } from "../logger.js";

const SHUTDOWN_TIMEOUT_MS = 5_000;

export function register_shutdown_handlers(
  app: RuntimeApp,
  logger: Logger,
  release_lock: () => Promise<void>,
): void {
  let shutting_down = false;

  const on_signal = (sig: string) => {
    if (shutting_down) return;
    shutting_down = true;
    logger.info(`graceful shutdown start signal=${sig}`);
    clearInterval(app.session_prune_timer);
    const force_exit = setTimeout(() => {
      logger.warn("shutdown timeout — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force_exit.unref();
    void app.services.stop()
      .then(() => app.agent_backends.close())
      .then(() => app.bus.close())
      .then(() => { if ("close" in app.sessions) (app.sessions as { close(): void }).close(); })
      .catch((err: unknown) => { logger.error(`shutdown error: ${error_message(err)}`); })
      .finally(() => {
        clearTimeout(force_exit);
        void release_lock().finally(() => {
          logger.info("graceful shutdown done");
          process.exit(0);
        });
      });
  };

  process.on("SIGINT", () => on_signal("SIGINT"));
  process.on("SIGTERM", () => on_signal("SIGTERM"));
}
