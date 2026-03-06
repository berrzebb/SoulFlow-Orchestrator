/** Webhook 수신 데이터 스토어. 인메모리 + 경로별 큐. */

import { create_logger } from "../logger.js";

const log = create_logger("webhook-store");

/** 수신된 webhook 페이로드. */
export interface WebhookPayload {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
  received_at: string;
}

const MAX_QUEUE_SIZE = 100;
const TTL_MS = 30 * 60 * 1000; // 30분

/** 경로별 수신 데이터 큐. */
export class WebhookStore {
  private queues = new Map<string, WebhookPayload[]>();

  /** 외부(대시보드 엔드포인트)에서 수신 데이터를 저장. */
  push(path: string, payload: WebhookPayload): void {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    let queue = this.queues.get(normalized);
    if (!queue) {
      queue = [];
      this.queues.set(normalized, queue);
    }
    queue.push(payload);
    // 큐 크기 제한
    if (queue.length > MAX_QUEUE_SIZE) queue.shift();
    log.info("webhook received", { path: normalized, method: payload.method });
  }

  /** 워크플로우 노드에서 수신 데이터를 소비 (FIFO). */
  async get(path: string): Promise<WebhookPayload | null> {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const queue = this.queues.get(normalized);
    if (!queue?.length) return null;

    const payload = queue.shift()!;

    // TTL 초과 데이터 스킵
    const age = Date.now() - new Date(payload.received_at).getTime();
    if (age > TTL_MS) {
      log.info("webhook expired", { path: normalized, age_ms: age });
      return this.get(path); // 재귀로 다음 것 시도
    }

    return payload;
  }

  /** 특정 경로의 대기 중인 페이로드 수. */
  pending_count(path: string): number {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return this.queues.get(normalized)?.length ?? 0;
  }

  /** 오래된 데이터 정리. */
  cleanup(): void {
    const now = Date.now();
    for (const [path, queue] of this.queues) {
      const filtered = queue.filter((p) => now - new Date(p.received_at).getTime() < TTL_MS);
      if (filtered.length === 0) this.queues.delete(path);
      else this.queues.set(path, filtered);
    }
  }
}
