import type { CorrelationContext } from "./observability/correlation.js";
import { correlation_fields } from "./observability/correlation.js";
import { now_iso } from "./utils/common.js";

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  /** 이름과 base context를 누적하는 자식 로거. OB-2: 부모의 correlation 필드를 상속. */
  child(name: string, base_ctx?: LogContext): Logger;
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function parse_log_level(raw: string | undefined): LogLevel {
  const v = String(raw || "info").trim().toLowerCase();
  if (v in LEVEL_ORDER) return v as LogLevel;
  return "info";
}

/**
 * OB-2 구조적 JSON envelope.
 * 모든 로그 출력은 이 스키마를 따른다. 후속 OB-3~OB-8이 이 envelope 위에 빌드한다.
 */
export type LogEnvelope = {
  ts: string;
  level: LogLevel;
  name: string;
  msg: string;
  /** OB-1 correlation fields (trace_id, request_id, run_id, ...). */
  trace_id?: string;
  request_id?: string;
  run_id?: string;
  workflow_id?: string;
  team_id?: string;
  user_id?: string;
  provider?: string;
  chat_id?: string;
  workspace_dir?: string;
  /** 실행 상태. "ok" | "error" | custom string. */
  status?: string;
  /** 실행 시간(ms). span 종료 시 채워진다. */
  duration_ms?: number;
  /** 에러 메시지. */
  error?: string;
  /** 추가 ad-hoc 필드. envelope 외 키는 여기에 포함. */
  [key: string]: unknown;
};

class ConsoleLogger implements Logger {
  private readonly name: string;
  private readonly min_level: number;
  private readonly base_ctx: LogContext;

  constructor(name: string, min_level: LogLevel, base_ctx: LogContext = {}) {
    this.name = name;
    this.min_level = LEVEL_ORDER[min_level];
    this.base_ctx = base_ctx;
  }

  debug(msg: string, ctx?: LogContext): void { this._emit("debug", msg, ctx); }
  info(msg: string, ctx?: LogContext): void { this._emit("info", msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this._emit("warn", msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this._emit("error", msg, ctx); }

  child(name: string, base_ctx?: LogContext): Logger {
    const level = Object.entries(LEVEL_ORDER).find(([, v]) => v === this.min_level)?.[0] as LogLevel || "info";
    return new ConsoleLogger(name, level, { ...this.base_ctx, ...base_ctx });
  }

  private _emit(level: LogLevel, msg: string, ctx?: LogContext): void {
    if (LEVEL_ORDER[level] < this.min_level) return;
    let line: string;
    try {
      line = JSON.stringify({ ts: now_iso(), level, name: this.name, msg, ...this.base_ctx, ...ctx });
    } catch {
      line = JSON.stringify({ ts: now_iso(), level, name: this.name, msg, _ctx_error: true });
    }
    if (level === "error") {
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

let _log_level: LogLevel = "info";
/** 모듈명 → 레벨 오버라이드 맵. LOG_LEVEL_<MODULE>=debug 환경변수로 자동 설정. */
const _module_overrides: Map<string, LogLevel> = new Map();

export function init_log_level(level: string | undefined): void {
  _log_level = parse_log_level(level);
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("LOG_LEVEL_") && val) {
      const module_name = key.slice("LOG_LEVEL_".length).toLowerCase().replace(/_/g, "-");
      _module_overrides.set(module_name, parse_log_level(val));
    }
  }
}

/** 특정 모듈의 로그 레벨을 런타임에 동적 오버라이드. */
export function set_module_log_level(module_name: string, level: "debug" | "info" | "warn" | "error"): void {
  _module_overrides.set(module_name, level);
}

export function create_logger(name: string, level_override?: "debug" | "info" | "warn" | "error"): Logger {
  const effective = level_override ?? _module_overrides.get(name) ?? _log_level;
  return new ConsoleLogger(name, effective);
}

/** CorrelationContext에서 LogContext로 변환. Logger.child()에 전달용. */
export function correlation_to_log_context(corr: Partial<CorrelationContext>): LogContext {
  return correlation_fields(corr);
}
