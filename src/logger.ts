export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(name: string): Logger;
}

import { now_iso } from "./utils/common.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function parse_log_level(raw: string | undefined): LogLevel {
  const v = String(raw || "info").trim().toLowerCase();
  if (v in LEVEL_ORDER) return v as LogLevel;
  return "info";
}

class ConsoleLogger implements Logger {
  private readonly name: string;
  private readonly min_level: number;

  constructor(name: string, min_level: LogLevel) {
    this.name = name;
    this.min_level = LEVEL_ORDER[min_level];
  }

  debug(msg: string, ctx?: LogContext): void { this._emit("debug", msg, ctx); }
  info(msg: string, ctx?: LogContext): void { this._emit("info", msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this._emit("warn", msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this._emit("error", msg, ctx); }

  child(name: string): Logger {
    const level = Object.entries(LEVEL_ORDER).find(([, v]) => v === this.min_level)?.[0] as LogLevel || "info";
    return new ConsoleLogger(name, level);
  }

  private _emit(level: LogLevel, msg: string, ctx?: LogContext): void {
    if (LEVEL_ORDER[level] < this.min_level) return;
    let line: string;
    try {
      line = JSON.stringify({ ts: now_iso(), level, name: this.name, msg, ...ctx });
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
  // LOG_LEVEL_<MODULE> 환경변수로 모듈별 오버라이드 자동 적용
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
