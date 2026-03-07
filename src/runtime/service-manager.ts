import type { ServiceLike } from "./service.types.js";
import type { Logger } from "../logger.js";

type ServiceEntry = {
  service: ServiceLike;
  required: boolean;
};

export class ServiceManager {
  private readonly entries: ServiceEntry[] = [];
  private readonly log: Logger;
  private started = false;

  constructor(logger: Logger) {
    this.log = logger;
  }

  register(service: ServiceLike, opts?: { required?: boolean }): void {
    this.entries.push({ service, required: opts?.required ?? true });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const entry of this.entries) {
      try {
        await entry.service.start();
        this.log.info(`service started: ${entry.service.name}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (entry.required) {
          this.log.error(`required service failed to start: ${entry.service.name}`, { error: msg });
          throw error;
        }
        this.log.warn(`optional service failed to start: ${entry.service.name}`, { error: msg });
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const entry of [...this.entries].reverse()) {
      try {
        await entry.service.stop();
        this.log.info(`service stopped: ${entry.service.name}`);
      } catch (error) {
        this.log.warn(`service stop error: ${entry.service.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async health_check(): Promise<Array<{ name: string; ok: boolean; details?: Record<string, unknown> }>> {
    const results: Array<{ name: string; ok: boolean; details?: Record<string, unknown> }> = [];
    for (const entry of this.entries) {
      try {
        const result = await entry.service.health_check();
        results.push({ name: entry.service.name, ...result });
      } catch {
        results.push({ name: entry.service.name, ok: false });
      }
    }
    return results;
  }
}
