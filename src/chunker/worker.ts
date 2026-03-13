/**
 * Chunk Worker — Redis Stream에서 작업을 소비하여 청킹 + 임베딩 수행.
 *
 * CPU-bound 작업을 orchestrator 프로세스에서 격리.
 * SQLite 접근 없음 — 순수 연산만 수행하고 결과를 Redis로 반환.
 */

import { Redis } from "ioredis";
import { hostname } from "node:os";
import { create_logger } from "../logger.js";
import { error_message, now_iso } from "../utils/common.js";
import { chunk_markdown } from "../agent/memory-chunker.js";
import { HTTP_FETCH_TIMEOUT_MS } from "../utils/timeouts.js";
import { ChunkQueue } from "./queue.js";
import {
  CHUNK_STREAM,
  CHUNK_CONSUMER_GROUP,
  encode_f32,
  type ChunkJobPayload,
  type ChunkJobResult,
  type ChunkEmbedding,
} from "./protocol.js";
import type { EmbedWorkerConfig } from "../agent/memory.types.js";

const log = create_logger("chunk-worker");

const MAX_EMBED_CHARS = 2000;
const MAX_BATCH_SIZE = 96;
const BLOCK_MS = 5_000;
const CLAIM_IDLE_MS = 60_000;

export interface ChunkWorkerOptions {
  redis_url: string;
  concurrency?: number;
}

/** Worker 루프를 시작하고 정리 함수를 반환. */
export async function start_chunk_worker(opts: ChunkWorkerOptions): Promise<{ close: () => Promise<void> }> {
  const client = new Redis(opts.redis_url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  const consumer_name = `${hostname()}:${process.pid}`;

  // Consumer Group 보장
  try {
    await client.xgroup("CREATE", CHUNK_STREAM, CHUNK_CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err) {
    if (!error_message(err).includes("BUSYGROUP")) throw err;
  }

  let running = true;

  const loop = async () => {
    log.info("chunk worker started", { consumer: consumer_name });

    while (running) {
      try {
        // 1. idle 메시지 claim 시도
        const claimed = await try_claim(client, consumer_name);
        if (claimed) {
          await process_entry(client, claimed.id, claimed.payload);
          continue;
        }

        // 2. 새 메시지 읽기
        const result = await client.xreadgroup(
          "GROUP", CHUNK_CONSUMER_GROUP, consumer_name,
          "COUNT", "1", "BLOCK", String(BLOCK_MS),
          "STREAMS", CHUNK_STREAM, ">",
        ) as Array<[string, Array<[string, string[]]>]> | null;

        if (!result?.[0]?.[1]?.length) continue;

        const [entry_id, fields] = result[0][1][0];
        const payload = parse_payload(fields);
        if (!payload) {
          await client.xack(CHUNK_STREAM, CHUNK_CONSUMER_GROUP, entry_id);
          continue;
        }

        await process_entry(client, entry_id, payload);
      } catch (err) {
        if (running) {
          log.warn("chunk worker loop error", { error: error_message(err) });
          await sleep(1000);
        }
      }
    }

    log.info("chunk worker stopped");
  };

  const loop_promise = loop();

  return {
    close: async () => {
      running = false;
      await loop_promise.catch(() => {});
      try { await client.quit(); } catch { client.disconnect(); }
    },
  };
}

async function process_entry(client: Redis, entry_id: string, payload: ChunkJobPayload): Promise<void> {
  const start = Date.now();
  log.info("processing chunk job", { job_id: payload.job_id, doc_key: payload.doc_key });

  const result = await process_chunk_job(payload, start);
  await ChunkQueue.store_result(client, result);
  await client.xack(CHUNK_STREAM, CHUNK_CONSUMER_GROUP, entry_id);

  log.info("chunk job completed", {
    job_id: payload.job_id,
    chunks: result.chunks.length,
    embeddings: result.embeddings?.length ?? 0,
    duration_ms: result.duration_ms,
    error: result.error,
  });
}

/** 청킹 + 임베딩 파이프라인 (순수 연산, SQLite 접근 없음). */
async function process_chunk_job(payload: ChunkJobPayload, start_ms: number): Promise<ChunkJobResult> {
  try {
    const chunks = chunk_markdown(payload.content, payload.doc_key);

    let embeddings: ChunkEmbedding[] | undefined;
    if (payload.embed && chunks.length > 0) {
      embeddings = await compute_embeddings(chunks, payload.embed);
    }

    return {
      job_id: payload.job_id,
      doc_key: payload.doc_key,
      chunks,
      embeddings,
      duration_ms: Date.now() - start_ms,
      completed_at: now_iso(),
    };
  } catch (err) {
    return {
      job_id: payload.job_id,
      doc_key: payload.doc_key,
      chunks: [],
      error: error_message(err),
      duration_ms: Date.now() - start_ms,
      completed_at: now_iso(),
    };
  }
}

/** 청크 텍스트를 임베딩 API로 변환, base64 인코딩 반환. */
async function compute_embeddings(
  chunks: Array<{ chunk_id: string; content: string }>,
  cfg: EmbedWorkerConfig,
): Promise<ChunkEmbedding[]> {
  const texts = chunks.map((c) => c.content.slice(0, MAX_EMBED_CHARS));
  const all_vecs: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const vecs = await fetch_embeddings(batch, cfg);
    if (vecs) all_vecs.push(...vecs);
    else return []; // API 실패 시 임베딩 전체 건너뜀
  }

  if (all_vecs.length !== chunks.length) return [];

  return chunks.map((c, i) => ({
    chunk_id: c.chunk_id,
    vector_b64: encode_f32(normalize_vec(all_vecs[i])),
  }));
}

async function fetch_embeddings(texts: string[], cfg: EmbedWorkerConfig): Promise<number[][] | null> {
  const body: Record<string, unknown> = { model: cfg.model, input: texts };
  if (cfg.dims) body.dimensions = cfg.dims;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;

  const res = await fetch(`${cfg.api_base}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const json = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function normalize_vec(v: number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function parse_payload(fields: string[]): ChunkJobPayload | null {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === "payload") {
      try { return JSON.parse(fields[i + 1]) as ChunkJobPayload; }
      catch { return null; }
    }
  }
  return null;
}

async function try_claim(
  client: Redis,
  consumer_name: string,
): Promise<{ id: string; payload: ChunkJobPayload } | null> {
  try {
    const result = await client.xautoclaim(
      CHUNK_STREAM, CHUNK_CONSUMER_GROUP, consumer_name,
      String(CLAIM_IDLE_MS), "0-0", "COUNT", "1",
    ) as [string, Array<[string, string[]]>, string[]];

    const entries = result?.[1];
    if (!entries?.length) return null;

    const [id, fields] = entries[0];
    const payload = parse_payload(fields);
    if (!payload) {
      await client.xack(CHUNK_STREAM, CHUNK_CONSUMER_GROUP, id);
      return null;
    }

    return { id, payload };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
