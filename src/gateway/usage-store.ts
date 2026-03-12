/**
 * LLM 호출 단위(span) 기록 저장소.
 * provider별·일별 비용 집계와 경량 Tracing을 제공한다.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { with_sqlite, with_sqlite_strict, type DatabaseSync } from "../utils/sqlite-helper.js";
import { short_id, now_iso } from "../utils/common.js";

export type LlmSpan = {
  span_id: string;
  provider_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  finish_reason: string;
  chat_id: string | null;
  at: string;
};

export type DailySummary = {
  date: string;
  provider_id: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
};

export type ProviderSummary = {
  provider_id: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
  error_calls: number;
};

export type ModelDailySummary = {
  date: string;
  provider_id: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

export type ListSpansFilter = {
  provider_id?: string;
  chat_id?: string;
  since?: string;
  limit?: number;
  offset?: number;
};

export class UsageStore {
  readonly sqlite_path: string;

  private readonly initialized: Promise<void>;
  private write_queue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    const usage_dir = join(root, "runtime", "usage");
    this.sqlite_path = join(usage_dir, "usage.db");
    this.initialized = this._init(usage_dir);
  }

  private with_sqlite<T>(run: (db: DatabaseSync) => T): T | null {
    return with_sqlite(this.sqlite_path, run);
  }

  private write_sqlite<T>(run: (db: DatabaseSync) => T): T {
    return with_sqlite_strict(this.sqlite_path, run);
  }

  private async _init(usage_dir: string): Promise<void> {
    await mkdir(usage_dir, { recursive: true });
    this.write_sqlite((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS llm_spans (
          span_id      TEXT PRIMARY KEY,
          provider_id  TEXT NOT NULL,
          model        TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd     REAL NOT NULL DEFAULT 0,
          latency_ms   INTEGER NOT NULL DEFAULT 0,
          finish_reason TEXT NOT NULL,
          chat_id      TEXT,
          at           TEXT NOT NULL,
          created_ms   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_spans_at       ON llm_spans(at DESC);
        CREATE INDEX IF NOT EXISTS idx_spans_provider ON llm_spans(provider_id, at DESC);
        CREATE INDEX IF NOT EXISTS idx_spans_chat     ON llm_spans(chat_id, at DESC);
        CREATE INDEX IF NOT EXISTS idx_spans_date     ON llm_spans(substr(at, 1, 10), provider_id);
      `);
      return true;
    });
  }

  private enqueue_write<T>(job: () => T): Promise<T> {
    const run = this.write_queue.then(job, job);
    this.write_queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 호출 결과를 비동기 큐에 쌓아 순차 기록. */
  record(input: Omit<LlmSpan, "span_id" | "at"> & { span_id?: string; at?: string }): void {
    void this.initialized.then(() =>
      this.enqueue_write(() => {
        const span_id = input.span_id || short_id();
        const at = input.at || now_iso();
        this.write_sqlite((db) => {
          db.prepare(`
            INSERT OR IGNORE INTO llm_spans
              (span_id, provider_id, model, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, total_tokens,
               cost_usd, latency_ms, finish_reason, chat_id, at, created_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            span_id,
            input.provider_id,
            input.model,
            input.input_tokens,
            input.output_tokens,
            input.cache_read_tokens,
            input.cache_write_tokens,
            input.total_tokens,
            input.cost_usd,
            input.latency_ms,
            input.finish_reason,
            input.chat_id ?? null,
            at,
            Date.now(),
          );
          return true;
        });
      }),
    ).catch(() => { /* 기록 실패는 주 흐름에 영향 없음 */ });
  }

  /** 최근 span 목록 조회. */
  async list_spans(filter?: ListSpansFilter): Promise<LlmSpan[]> {
    await this.initialized;
    const limit = Math.max(1, Math.min(500, Number(filter?.limit ?? 100)));
    const offset = Math.max(0, Number(filter?.offset ?? 0));
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (filter?.provider_id) { where.push("provider_id = ?"); params.push(filter.provider_id); }
    if (filter?.chat_id)     { where.push("chat_id = ?");     params.push(filter.chat_id); }
    if (filter?.since)       { where.push("at >= ?");          params.push(filter.since); }
    const sql = [
      "SELECT span_id, provider_id, model, input_tokens, output_tokens, cache_read_tokens,",
      "cache_write_tokens, total_tokens, cost_usd, latency_ms, finish_reason, chat_id, at",
      "FROM llm_spans",
      where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      "ORDER BY at DESC",
      "LIMIT ? OFFSET ?",
    ].filter(Boolean).join(" ");
    params.push(limit, offset);
    return (this.with_sqlite((db) => db.prepare(sql).all(...params)) ?? []) as LlmSpan[];
  }

  /** 일별 프로바이더 집계 (최근 N일). */
  async get_daily_summary(days = 30): Promise<DailySummary[]> {
    await this.initialized;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    type Row = {
      date: string; provider_id: string; calls: number;
      input_tokens: number; output_tokens: number; total_tokens: number;
      cost_usd: number; avg_latency_ms: number;
    };
    const rows = (this.with_sqlite((db) => db.prepare(`
      SELECT
        substr(at, 1, 10)   AS date,
        provider_id,
        COUNT(*)            AS calls,
        SUM(input_tokens)   AS input_tokens,
        SUM(output_tokens)  AS output_tokens,
        SUM(total_tokens)   AS total_tokens,
        SUM(cost_usd)       AS cost_usd,
        AVG(latency_ms)     AS avg_latency_ms
      FROM llm_spans
      WHERE substr(at, 1, 10) >= ?
      GROUP BY date, provider_id
      ORDER BY date DESC, provider_id
    `).all(since)) ?? []) as Row[];
    return rows.map((r) => ({
      date: r.date,
      provider_id: r.provider_id,
      calls: Number(r.calls),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: Number(r.cost_usd),
      avg_latency_ms: Math.round(Number(r.avg_latency_ms)),
    }));
  }

  /** 당일 프로바이더·모델별 집계. */
  async get_today_by_model(): Promise<ModelDailySummary[]> {
    await this.initialized;
    const today = new Date().toISOString().slice(0, 10);
    type Row = {
      date: string; provider_id: string; model: string; calls: number;
      input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number;
    };
    const rows = (this.with_sqlite((db) => db.prepare(`
      SELECT
        substr(at, 1, 10) AS date,
        provider_id,
        model,
        COUNT(*)            AS calls,
        SUM(input_tokens)   AS input_tokens,
        SUM(output_tokens)  AS output_tokens,
        SUM(total_tokens)   AS total_tokens,
        SUM(cost_usd)       AS cost_usd
      FROM llm_spans
      WHERE substr(at, 1, 10) = ?
      GROUP BY provider_id, model
      ORDER BY provider_id, total_tokens DESC
    `).all(today)) ?? []) as Row[];
    return rows.map((r) => ({
      date: r.date,
      provider_id: r.provider_id,
      model: r.model,
      calls: Number(r.calls),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: Number(r.cost_usd),
    }));
  }

  /** 프로바이더별 전체 집계 (최근 30일). */
  async get_provider_summary(days = 30): Promise<ProviderSummary[]> {
    await this.initialized;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    type Row = {
      provider_id: string; calls: number;
      input_tokens: number; output_tokens: number; total_tokens: number;
      cost_usd: number; avg_latency_ms: number; error_calls: number;
    };
    const rows = (this.with_sqlite((db) => db.prepare(`
      SELECT
        provider_id,
        COUNT(*)                                  AS calls,
        SUM(input_tokens)                         AS input_tokens,
        SUM(output_tokens)                        AS output_tokens,
        SUM(total_tokens)                         AS total_tokens,
        SUM(cost_usd)                             AS cost_usd,
        AVG(latency_ms)                           AS avg_latency_ms,
        SUM(CASE WHEN finish_reason = 'error' THEN 1 ELSE 0 END) AS error_calls
      FROM llm_spans
      WHERE substr(at, 1, 10) >= ?
      GROUP BY provider_id
      ORDER BY cost_usd DESC
    `).all(since)) ?? []) as Row[];
    return rows.map((r) => ({
      provider_id: r.provider_id,
      calls: Number(r.calls),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: Number(r.cost_usd),
      avg_latency_ms: Math.round(Number(r.avg_latency_ms)),
      error_calls: Number(r.error_calls),
    }));
  }
}
