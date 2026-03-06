import type { Logger } from "../logger.js";
import { error_message } from "../utils/common.js";
import type { ServiceLike } from "./service.types.js";

interface RegisteredService {
  service: ServiceLike;
  required: boolean;
}

/**
 * 런타임 서비스 레지스트리.
 * - 등록 순서대로 start, 역순으로 stop.
 * - health_check()는 모든 서비스의 상태를 배열로 반환.
 */
export class ServiceManager {
  private readonly entries: RegisteredService[] = [];
  private readonly logger: Logger | null;

  constructor(logger?: Logger | null) {
    this.logger = logger ?? null;
  }

  /** 서비스를 등록한다. required=true 이면 start 실패 시 예외를 전파한다. */
  register(service: ServiceLike, opts?: { required?: boolean }): void {
    this.entries.push({ service, required: opts?.required ?? false });
  }

  /** 등록된 모든 서비스를 순서대로 시작한다. */
  async start(): Promise<void> {
    for (const { service, required } of this.entries) {
      try {
        await service.start();
        this.logger?.info(`[services] started: ${service.name}`);
      } catch (err) {
        this.logger?.error(`[services] failed to start: ${service.name} — ${error_message(err)}`);
        if (required) throw err;
      }
    }
  }

  /** 등록된 모든 서비스를 역순으로 정지한다. */
  async stop(): Promise<void> {
    for (const { service } of [...this.entries].reverse()) {
      try {
        await service.stop();
        this.logger?.info(`[services] stopped: ${service.name}`);
      } catch (err) {
        this.logger?.warn(`[services] error stopping: ${service.name} — ${error_message(err)}`);
      }
    }
  }

  /**
   * 모든 서비스의 health 상태를 배열로 반환한다.
   * 개별 health_check()가 throw 하더라도 전체 배열 반환을 보장한다.
   */
  async health_check(): Promise<Array<{ name: string; ok: boolean; details?: Record<string, unknown> }>> {
    const checks = this.entries.map(async ({ service }) => {
      try {
        const result = await Promise.resolve(service.health_check());
        return { name: service.name, ...result };
      } catch (err) {
        this.logger?.warn(`[services] health_check error: ${service.name} — ${error_message(err)}`);
        return { name: service.name, ok: false };
      }
    });
    return Promise.all(checks);
  }
}
