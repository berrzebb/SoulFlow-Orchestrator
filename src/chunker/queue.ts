/**
 * Chunk 작업 큐 — Orchestrator 측 producer + 완료 리스너.
 *
 * submit(): Redis Stream에 작업 발행.
 * on_complete(): Pub/Sub로 완료 통보 수신 → 결과 fetch → 콜백.
 */

import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { create_logger } from "../logger.js";
import { error_message, now_iso } from "../utils/common.js";
import {
  CHUNK_STREAM,
  CHUNK_CONSUMER_GROUP,
  CHUNK_RESULT_PREFIX,
  CHUNK_DONE_CHANNEL,
  CHUNK_RESULT_TTL,
  type ChunkJobPayload,
  type ChunkJobResult,
} from "./protocol.js";

const log = create_logger("chunk-queue");

const STREAM_MAXLEN = 5_000;

export type ChunkCompleteCallback = (result: ChunkJobResult) => void;

export class ChunkQueue {
  private readonly client: Redis;
  private subscriber: Redis | null = null;
  private readonly callbacks: ChunkCompleteCallback[] = [];
  private closed = false;

  constructor(private readonly redis_url: string) {
    this.client = new Redis(redis_url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
    });
  }

  /** Redis 연결 + Stream/Consumer Group 부트스트랩. */
  async connect(): Promise<void> {
    await this.client.connect();
    try {
      await this.client.xgroup("CREATE", CHUNK_STREAM, CHUNK_CONSUMER_GROUP, "0", "MKSTREAM");
      log.info("chunk stream consumer group created");
    } catch (err) {
      if (!error_message(err).includes("BUSYGROUP")) throw err;
    }
  }

  /** 청킹 작업을 큐에 제출. 즉시 반환 (비동기). */
  async submit(params: {
    doc_key: string;
    kind: string;
    day: string;
    content: string;
    embed?: ChunkJobPayload["embed"];
  }): Promise<string> {
    if (this.closed) throw new Error("ChunkQueue is closed");

    const job_id = randomUUID();
    const payload: ChunkJobPayload = {
      job_id,
      doc_key: params.doc_key,
      kind: params.kind,
      day: params.day,
      content: params.content,
      embed: params.embed,
      submitted_at: now_iso(),
    };

    await this.client.xadd(
      CHUNK_STREAM,
      "MAXLEN", "~", String(STREAM_MAXLEN),
      "*",
      "payload", JSON.stringify(payload),
    );

    log.info("chunk job submitted", { job_id, doc_key: params.doc_key });
    return job_id;
  }

  /** 완료 통보 리스너 등록. Pub/Sub로 결과 수신 후 콜백 호출. */
  on_complete(cb: ChunkCompleteCallback): void {
    this.callbacks.push(cb);
    if (!this.subscriber) this.start_subscriber();
  }

  private start_subscriber(): void {
    this.subscriber = new Redis(this.redis_url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });

    this.subscriber.subscribe(CHUNK_DONE_CHANNEL).catch((err) => {
      log.warn("chunk subscriber failed", { error: error_message(err) });
    });

    this.subscriber.on("message", (_channel, message) => {
      this.handle_completion(message).catch((err) => {
        log.warn("chunk completion handler error", { error: error_message(err) });
      });
    });
  }

  private async handle_completion(job_id: string): Promise<void> {
    const key = `${CHUNK_RESULT_PREFIX}${job_id}`;
    const raw = await this.client.get(key);
    if (!raw) {
      log.warn("chunk result not found", { job_id });
      return;
    }

    await this.client.del(key);
    const result = JSON.parse(raw) as ChunkJobResult;

    for (const cb of this.callbacks) {
      try { cb(result); } catch (err) {
        log.warn("chunk callback error", { job_id, error: error_message(err) });
      }
    }
  }

  /** Redis 결과 키에 직접 저장 (worker 측에서 사용). */
  static async store_result(client: Redis, result: ChunkJobResult): Promise<void> {
    const key = `${CHUNK_RESULT_PREFIX}${result.job_id}`;
    await client.set(key, JSON.stringify(result), "EX", CHUNK_RESULT_TTL);
    await client.publish(CHUNK_DONE_CHANNEL, result.job_id);
  }

  async close(): Promise<void> {
    this.closed = true;
    try { this.subscriber?.disconnect(); } catch { /* noop */ }
    try { await this.client.quit(); } catch { this.client.disconnect(); }
    log.info("chunk queue closed");
  }

  is_closed(): boolean { return this.closed; }
}
