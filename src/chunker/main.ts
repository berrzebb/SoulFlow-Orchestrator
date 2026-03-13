/** Chunk Worker 엔트리포인트 — 별도 컨테이너에서 실행. */

import { start_chunk_worker } from "./worker.js";
import { create_logger } from "../logger.js";

const log = create_logger("chunker");

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

async function main() {
  log.info("chunk worker starting", { redis: REDIS_URL });

  const worker = await start_chunk_worker({ redis_url: REDIS_URL });

  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("chunk worker fatal", { error: String(err) });
  process.exit(1);
});
