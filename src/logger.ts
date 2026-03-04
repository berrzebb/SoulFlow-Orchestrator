export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(name: string): Logger;
}

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
      line = JSON.stringify({ ts: new Date().toISOString(), level, name: this.name, msg, ...ctx });
    } catch {
      line = JSON.stringify({ ts: new Date().toISOString(), level, name: this.name, msg, _ctx_error: true });
    }
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

let _log_level: LogLevel = "info";

export function init_log_level(level: string | undefined): void {
  _log_level = parse_log_level(level);
}

export function create_logger(name: string, level_override?: "debug" | "info" | "warn" | "error"): Logger {
  return new ConsoleLogger(name, level_override ?? _log_level);
}
