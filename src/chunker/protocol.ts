/** Chunk 작업 큐 프로토콜 — Redis Streams 기반 비동기 청킹 파이프라인. */

import type { MemoryChunk } from "../agent/memory-chunker.js";
import type { EmbedWorkerConfig } from "../agent/memory.types.js";

// ── Redis key 규약 ──────────────────────────────────────────────────────────

export const CHUNK_STREAM = "sf:chunk:jobs";
export const CHUNK_CONSUMER_GROUP = "chunk-workers";
export const CHUNK_RESULT_PREFIX = "sf:chunk:result:";
export const CHUNK_DONE_CHANNEL = "sf:chunk:done";
export const CHUNK_RESULT_TTL = 3600;

// ── Job 페이로드 (Orchestrator → Worker) ────────────────────────────────────

export interface ChunkJobPayload {
  job_id: string;
  doc_key: string;
  kind: string;
  day: string;
  content: string;
  embed?: EmbedWorkerConfig;
  submitted_at: string;
}

// ── Job 결과 (Worker → Orchestrator) ────────────────────────────────────────

export interface ChunkJobResult {
  job_id: string;
  doc_key: string;
  chunks: MemoryChunk[];
  /** chunk_id → normalized Float32 embedding (base64 인코딩). */
  embeddings?: ChunkEmbedding[];
  error?: string;
  duration_ms: number;
  completed_at: string;
}

export interface ChunkEmbedding {
  chunk_id: string;
  /** base64 인코딩된 Float32Array — Redis JSON 전송 최적화. */
  vector_b64: string;
}

// ── 직렬화 헬퍼 ─────────────────────────────────────────────────────────────

export function encode_f32(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function decode_f32(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
