import { create_logger } from "../logger.js";
import type { MessageBusRuntime } from "./types.js";
import { InMemoryMessageBus } from "./service.js";

const log = create_logger("bus-factory");

export type BusFactoryConfig = {
  backend: "memory" | "redis";
  redis?: {
    url: string;
    keyPrefix?: string;
    blockMs?: number;
    claimIdleMs?: number;
    streamMaxlen?: {
      inbound: number;
      outbound: number;
      progress: number;
    };
  };
};

function redact_url(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url.replace(/:\/\/[^@]*@/, "://***@");
  }
}

export async function create_message_bus(config: BusFactoryConfig): Promise<MessageBusRuntime> {
  if (config.backend === "redis" && config.redis?.url) {
    const { RedisMessageBus } = await import("./redis-bus.js");
    const bus = new RedisMessageBus({
      url: config.redis.url,
      key_prefix: config.redis.keyPrefix,
      block_ms: config.redis.blockMs,
      claim_idle_ms: config.redis.claimIdleMs,
      stream_maxlen: config.redis.streamMaxlen,
    });
    log.info("message bus: redis", { url: redact_url(config.redis.url) });
    return bus;
  }

  log.info("message bus: memory");
  return new InMemoryMessageBus();
}
