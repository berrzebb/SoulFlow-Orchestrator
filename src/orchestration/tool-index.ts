/**
 * FTS5 + sqlite-vec 하이브리드 도구 인덱스.
 *
 * 165개 도구 전체 스키마 ≈ 25,000 토큰 → 20~30개 선택 시 ≈ 3,000~4,500 토큰 (80% 절감).
 *
 * 동작:
 * 1. 도구 등록 시 name + description + action enum + 카테고리를 FTS5 테이블에 저장
 * 2. 요청 텍스트에서 키워드를 추출 + 한국어 확장 → FTS5 MATCH 쿼리
 * 3. BM25 랭킹 상위 도구 + 벡터 KNN 시멘틱 보강 + core 도구 + 카테고리 폴백 반환
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { ToolSchema } from "../agent/tools/types.js";
import type { EmbedFn } from "../agent/memory.service.js";

/** 항상 포함되는 core 도구. 사용자 상호작용 + 기본 실행에 필수. */
const CORE_TOOLS = new Set([
  "message", "ask_user", "request_file", "send_file",
  "read_file", "write_file", "edit_file", "list_dir", "search_files",
  "exec", "memory", "datetime", "chain",
]);

/** 도구 description/name에서 제거할 불용어. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "and", "or", "but", "if", "then", "else", "when", "while", "for",
  "to", "from", "in", "on", "at", "by", "with", "of", "about", "into",
  "through", "between", "after", "before", "during", "without", "within",
  "this", "that", "these", "those", "it", "its", "they", "them", "their",
  "all", "each", "every", "any", "some", "no", "not", "only", "very",
  "just", "also", "so", "too", "more", "most", "less", "least",
  "such", "than", "other", "like", "how", "what", "which", "who",
  "use", "using", "used", "tool", "tools", "action", "actions",
  "operation", "operations", "data", "value", "values", "input", "output",
  "string", "number", "boolean", "object", "array", "default", "based",
  "returns", "return", "given", "e", "g", "etc", "via",
]);

/** 한국어 키워드 → 영어 태그 매핑. */
const KO_KEYWORD_MAP: Record<string, string[]> = {
  "파일": ["file", "filesystem", "read_file", "write_file"],
  "검색": ["search", "web_search", "grep", "find"],
  "웹": ["web", "http", "fetch", "url"],
  "이메일": ["email", "mail"],
  "메시지": ["message", "send", "messaging"],
  "변환": ["convert", "transform", "format"],
  "인코딩": ["encoding", "encode", "decode", "base64"],
  "해시": ["hash", "checksum", "md5", "sha"],
  "암호": ["crypto", "encrypt", "decrypt", "password"],
  "날짜": ["date", "datetime", "time", "timezone"],
  "시간": ["time", "datetime", "duration", "cron"],
  "정규식": ["regex", "pattern", "match"],
  "수학": ["math", "calculate", "matrix", "stats"],
  "통계": ["stats", "statistics", "timeseries"],
  "그래프": ["graph", "diagram", "chart"],
  "다이어그램": ["diagram", "mermaid", "svg", "chart"],
  "차트": ["chart", "svg", "diagram"],
  "이미지": ["image", "screenshot", "svg", "qr"],
  "데이터베이스": ["database", "sql", "db", "query"],
  "네트워크": ["network", "dns", "ping", "http"],
  "도커": ["docker", "container"],
  "깃": ["git", "commit", "branch"],
  "아카이브": ["archive", "compress", "zip", "tar"],
  "압축": ["compress", "archive", "gzip"],
  "크론": ["cron", "crontab", "schedule"],
  "토큰": ["tokenizer", "token", "estimate"],
  "유사도": ["similarity", "cosine", "levenshtein"],
  "감성": ["sentiment", "analyze"],
  "마스킹": ["data_mask", "pii", "redact", "mask"],
  "서킷": ["circuit_breaker", "breaker"],
  "메트릭": ["metric", "counter", "gauge", "prometheus"],
  "페이지": ["pagination", "page", "offset", "cursor"],
  "헤더": ["http_header", "header", "content_type"],
  "플래그": ["feature_flag", "flag", "rollout"],
  "검증": ["validator", "validate", "json_schema", "checksum"],
  "CSV": ["csv", "table"],
  "JSON": ["json", "json_patch", "json_schema", "jsonl"],
  "XML": ["xml", "parse"],
  "YAML": ["yaml", "parse"],
  "PDF": ["pdf", "web_pdf"],
  "마크다운": ["markdown", "md"],
  "HTML": ["html", "web", "parse"],
  "템플릿": ["template", "template_engine"],
  "캐시": ["cache", "ttl_cache"],
  "큐": ["queue", "rate_limit"],
  "비밀": ["secret", "vault"],
  "보안": ["security", "password", "crypto", "jwt", "data_mask"],
  "라이선스": ["license"],
  "의존성": ["dependency", "package"],
  "텍스트": ["text", "tokenizer", "markdown", "format"],
  "상태": ["state_machine", "circuit_breaker"],
  "트리": ["tree", "traverse", "hierarchy"],
  "블룸": ["bloom_filter", "bloom"],
  "워크플로우": ["workflow"],
  "코드": ["code", "code_diagram", "eval"],
  "셸": ["exec", "shell", "process"],
  "프로세스": ["process", "exec", "shell"],
  "SSH": ["ssh", "remote"],
  "FTP": ["ftp", "transfer"],
  "Redis": ["redis", "cache"],
  "MQTT": ["mqtt", "publish", "subscribe"],
  "QR": ["qr", "barcode"],
  "SVG": ["svg", "chart", "diagram"],
  "색상": ["color", "hex", "rgb"],
  "국가": ["country", "geo", "timezone"],
  "단위": ["unit_convert", "convert"],
  "전화": ["phone", "validate"],
  "바코드": ["barcode", "qr"],
  "로그": ["log_parser", "syslog"],
  "DNS": ["dns", "lookup", "resolve"],
  "OAuth": ["oauth_fetch", "oauth", "token"],
  "JWT": ["jwt", "token", "verify"],
  "GraphQL": ["graphql", "query"],
  "RSS": ["rss", "feed"],
  "WebSocket": ["websocket", "ws"],
  "S3": ["s3", "bucket", "object"],
  "LDAP": ["ldap", "directory"],
  "프로토버프": ["protobuf", "proto"],
  "알림": ["notification", "notify"],
  "승인": ["approval", "decision"],
  "스폰": ["spawn"],
  "diff": ["diff", "compare", "patch"],
  "슬러그": ["slug", "url"],
  "UUID": ["uuid", "id", "generate"],
  "랜덤": ["random", "generate"],
};

const VEC_DIMENSIONS = 256;
const MAX_EMBED_CHARS = 1500;

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS tools (
    name         TEXT PRIMARY KEY,
    category     TEXT NOT NULL,
    core         INTEGER NOT NULL DEFAULT 0,
    desc_raw     TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tool_docs (
    rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT ''
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(
    name, description, tags,
    content='tool_docs',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
`;

/** FTS5 특수문자를 이스케이프. */
function escape_fts(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** 텍스트를 소문자 토큰으로 분리. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** 도구 스키마에서 검색용 태그 문자열을 추출. */
function extract_tags(schema: ToolSchema, category: string): string {
  const parts: string[] = [];
  const name = schema.function.name;

  // 도구 이름 (snake_case 분리)
  parts.push(name);
  for (const p of name.split("_")) {
    if (p.length >= 2 && !STOP_WORDS.has(p)) parts.push(p);
  }

  // 카테고리
  parts.push(category);

  // action enum 값
  const action_prop = schema.function.parameters?.properties?.action;
  if (action_prop && Array.isArray(action_prop.enum)) {
    for (const action of action_prop.enum) {
      const a = String(action);
      parts.push(a);
      for (const p of a.split("_")) {
        if (p.length >= 3 && !STOP_WORDS.has(p)) parts.push(p);
      }
    }
  }

  return [...new Set(parts)].join(" ");
}

export class ToolIndex {
  private db_path: string | null = null;
  private tool_count = 0;
  private embed_fn: EmbedFn | null = null;

  /** 임베딩 함수를 주입하여 벡터 시멘틱 검색 활성화. */
  set_embed(fn: EmbedFn): void { this.embed_fn = fn; }

  /** 도구 스키마 + 카테고리 정보로 FTS5 인덱스를 빌드. */
  build(schemas: ToolSchema[], category_map: Record<string, string>, db_path?: string): void {
    if (db_path) this.db_path = db_path;
    if (!this.db_path) return;

    mkdirSync(dirname(this.db_path), { recursive: true });
    const db = new Database(this.db_path);
    try {
      db.pragma("journal_mode=WAL");
      // 마이그레이션: 구 스키마 또는 손상된 FTS5 shadow 테이블 정리.
      // tool_docs가 없으면 구 스키마 → 전체 정리 후 재생성.
      // tool_docs가 있더라도 FTS5 shadow 테이블이 손상되었으면 FTS만 재생성.
      const has_tool_docs = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tool_docs'").get();
      if (!has_tool_docs) {
        for (const t of ["tools_fts", "tools_fts_content", "tools_fts_data", "tools_fts_idx", "tools_fts_docsize", "tools_fts_config"]) {
          db.exec(`DROP TABLE IF EXISTS ${t}`);
        }
      } else {
        // FTS5 무결성 검사 — shadow 테이블 손상 시 재생성
        try {
          db.prepare("SELECT 1 FROM tools_fts LIMIT 0").run();
        } catch {
          for (const t of ["tools_fts", "tools_fts_content", "tools_fts_data", "tools_fts_idx", "tools_fts_docsize", "tools_fts_config"]) {
            db.exec(`DROP TABLE IF EXISTS ${t}`);
          }
        }
      }
      db.exec(INIT_SQL);

      // sqlite-vec 확장 로드 + vec0 테이블 생성
      sqliteVec.load(db);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tools_vec USING vec0(embedding float[${VEC_DIMENSIONS}])`);

      // 기존 데이터 삭제 후 재삽입
      // FTS5 external content 모드에서는 DELETE가 shadow 테이블 접근 오류를 유발하므로 DROP+CREATE
      db.exec("DELETE FROM tools");
      db.exec("DELETE FROM tool_docs");
      db.exec("DROP TABLE IF EXISTS tools_fts");
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(
        name, description, tags,
        content='tool_docs',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      )`);
      db.exec("DELETE FROM tools_vec");

      const insert_tool = db.prepare(
        "INSERT INTO tools (name, category, core, desc_raw, content_hash) VALUES (?, ?, ?, ?, ?)",
      );
      const insert_fts = db.prepare(
        "INSERT INTO tool_docs (name, description, tags) VALUES (?, ?, ?)",
      );
      const insert_fts_idx = db.prepare(
        "INSERT INTO tools_fts (rowid, name, description, tags) VALUES (?, ?, ?, ?)",
      );

      const batch = db.transaction(() => {
        for (const schema of schemas) {
          const name = schema.function.name;
          const desc = schema.function.description || "";
          const category = category_map[name] || "external";
          const core = CORE_TOOLS.has(name) ? 1 : 0;
          const tags = extract_tags(schema, category);
          const hash = simple_hash(`${name}|${desc}|${tags}`);

          insert_tool.run(name, category, core, desc, hash);
          const info = insert_fts.run(name, desc, tags);
          insert_fts_idx.run(info.lastInsertRowid, name, desc, tags);
        }
      });
      batch();
      this.tool_count = schemas.length;
    } finally {
      db.close();
    }
  }

  /** 요청 텍스트에서 관련 도구를 선택 (FTS5 + 벡터 하이브리드). */
  async select(
    request_text: string,
    opts?: {
      max_tools?: number;
      mode?: "once" | "agent" | "task";
      classifier_tools?: string[];
      classifier_categories?: string[];
    },
  ): Promise<Set<string>> {
    if (!this.db_path) return new Set();

    const max = opts?.max_tools ?? 30;
    const selected = new Set<string>();

    // DB 또는 테이블이 손상/누락된 경우 빈 셋 반환 (다음 build()에서 복구됨)
    let db: InstanceType<typeof Database> | null = null;
    try {
      db = new Database(this.db_path, { readonly: true });

      // 스키마 무결성 확인: tools 테이블이 없으면 빈 셋 반환
      const has_tools = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tools'").get();
      if (!has_tools) return selected;

      // 1) Core 도구 항상 포함
      const core_rows = db.prepare("SELECT name FROM tools WHERE core = 1").all() as { name: string }[];
      for (const r of core_rows) selected.add(r.name);

      // 2) 분류기가 명시적으로 지정한 도구
      if (opts?.classifier_tools?.length) {
        const placeholders = opts.classifier_tools.map(() => "?").join(",");
        const rows = db.prepare(`SELECT name FROM tools WHERE name IN (${placeholders})`).all(...opts.classifier_tools) as { name: string }[];
        for (const r of rows) selected.add(r.name);
      }

      // 3) FTS5 쿼리 구성 (shadow 테이블 손상 대비 방어)
      const query_terms = this.build_fts_query(request_text);
      if (query_terms) {
        const remaining = max - selected.size;
        if (remaining > 0) {
          try {
            const fts_rows = db.prepare(`
              SELECT c.name, bm25(tools_fts, 5.0, 2.0, 1.0) AS rank
              FROM tools_fts f
              JOIN tool_docs c ON c.rowid = f.rowid
              WHERE tools_fts MATCH ?
              ORDER BY rank
              LIMIT ?
            `).all(query_terms, remaining + selected.size) as { name: string; rank: number }[];

            for (const r of fts_rows) {
              if (selected.size >= max) break;
              selected.add(r.name);
            }
          } catch {
            // FTS5 shadow 테이블 손상 — 다음 build()에서 복구됨. 카테고리 폴백으로 진행.
          }
        }
      }

      // 4) 카테고리 폴백 — 매칭 도구가 부족하면 카테고리로 보강
      if (selected.size < 15 && opts?.classifier_categories?.length) {
        const placeholders = opts.classifier_categories.map(() => "?").join(",");
        const cat_rows = db.prepare(
          `SELECT name FROM tools WHERE category IN (${placeholders}) LIMIT ?`,
        ).all(...opts.classifier_categories, max - selected.size) as { name: string }[];
        for (const r of cat_rows) {
          if (selected.size >= max) break;
          selected.add(r.name);
        }
      }
    } catch {
      // DB 파일 손상, 테이블 누락 등 — 빈 셋 반환, 다음 build()에서 복구
      return selected;
    } finally {
      db?.close();
    }

    // 5) 벡터 시멘틱 보강 — FTS5 결과가 부족할 때 벡터 KNN으로 추가
    if (this.embed_fn && selected.size < max) {
      try {
        const vec_names = await this.vector_search(request_text, max - selected.size + 5);
        for (const name of vec_names) {
          if (selected.size >= max) break;
          selected.add(name);
        }
      } catch { /* 벡터 검색 실패 시 FTS5 결과만 사용 */ }
    }

    return selected;
  }

  /** 벡터 KNN으로 시멘틱 유사 도구 검색. */
  private async vector_search(query_text: string, k: number): Promise<string[]> {
    if (!this.embed_fn || !this.db_path) return [];

    // lazy 임베딩: 아직 벡터가 없는 도구 임베딩
    await this.ensure_embeddings_fresh();

    // 쿼리 벡터 생성
    const truncated = query_text.slice(0, MAX_EMBED_CHARS);
    const { embeddings } = await this.embed_fn([truncated], { dimensions: VEC_DIMENSIONS });
    if (!embeddings.length) return [];
    const query_vec = normalize_vec(embeddings[0]);
    const query_buf = new Float32Array(query_vec);

    // KNN
    const db = new Database(this.db_path, { readonly: true });
    try {
      sqliteVec.load(db);
      // vec0에서 가까운 rowid → tool_docs에서 name 조회
      // rowid는 tool_docs.rowid와 일치 (build에서 동기화)
      const rows = db.prepare(`
        SELECT v.rowid, v.distance
        FROM tools_vec v
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance
      `).all(query_buf, k) as { rowid: number; distance: number }[];

      if (!rows.length) return [];
      const rowids = rows.map(r => r.rowid);
      const placeholders = rowids.map(() => "?").join(",");
      const name_rows = db.prepare(
        `SELECT name FROM tool_docs WHERE rowid IN (${placeholders})`,
      ).all(...rowids) as { name: string }[];
      return name_rows.map(r => r.name);
    } finally {
      db.close();
    }
  }

  /** content_hash가 변경된 도구만 배치 임베딩하여 vec0 갱신. */
  private async ensure_embeddings_fresh(): Promise<void> {
    if (!this.embed_fn || !this.db_path) return;

    const db = new Database(this.db_path);
    try {
      sqliteVec.load(db);

      // vec0에 없는 도구 또는 content_hash가 변경된 도구 검출
      const stale_rows = db.prepare(`
        SELECT c.rowid, t.name, t.desc_raw, t.content_hash
        FROM tools t
        JOIN tool_docs c ON c.name = t.name
        WHERE NOT EXISTS (SELECT 1 FROM tools_vec v WHERE v.rowid = c.rowid)
      `).all() as { rowid: number; name: string; desc_raw: string; content_hash: string }[];

      if (!stale_rows.length) return;

      // 배치 임베딩
      const texts = stale_rows.map(r => `${r.name}: ${r.desc_raw}`.slice(0, MAX_EMBED_CHARS));
      const { embeddings } = await this.embed_fn(texts, { dimensions: VEC_DIMENSIONS });

      const del_vec = db.prepare("DELETE FROM tools_vec WHERE rowid = ?");
      const ins_vec = db.prepare("INSERT INTO tools_vec (rowid, embedding) VALUES (?, ?)");

      const batch = db.transaction(() => {
        for (let i = 0; i < stale_rows.length; i++) {
          const rid = BigInt(stale_rows[i].rowid);
          const vec = normalize_vec(embeddings[i]);
          const buf = new Float32Array(vec);
          del_vec.run(rid);
          ins_vec.run(rid, buf);
        }
      });
      batch();
    } finally {
      db.close();
    }
  }

  /** 요청 텍스트에서 FTS5 MATCH 쿼리를 생성. */
  private build_fts_query(text: string): string | null {
    const terms = new Set<string>();

    // 영문 키워드
    for (const word of tokenize(text)) {
      if (!STOP_WORDS.has(word) && word.length >= 2) terms.add(word);
    }

    // 한국어 키워드 → 영어 태그 확장
    for (const [ko, en_tags] of Object.entries(KO_KEYWORD_MAP)) {
      if (text.includes(ko)) {
        for (const t of en_tags) terms.add(t);
      }
    }

    // camelCase, snake_case 식별자 분리
    const identifiers = text.match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g) || [];
    for (const id of identifiers) {
      const lower = id.toLowerCase();
      terms.add(lower);
      for (const part of lower.split("_")) {
        if (part.length >= 3 && !STOP_WORDS.has(part)) terms.add(part);
      }
    }

    if (terms.size === 0) return null;

    // OR 조합: 하나라도 매칭되면 결과에 포함, BM25가 관련도 순위 결정
    return [...terms].map(escape_fts).join(" OR ");
  }

  get size(): number { return this.tool_count; }
}

/** L2 정규화. */
function normalize_vec(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

/** FNV-1a 32bit 해시 (content 변경 감지용). */
function simple_hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

