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

function format_ctx(ctx: LogContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

class ConsoleLogger implements Logger {
  private readonly prefix: string;
  private readonly min_level: number;

  constructor(name: string, min_level: LogLevel) {
    this.prefix = `[${name}]`;
    this.min_level = LEVEL_ORDER[min_level];
  }

  debug(msg: string, ctx?: LogContext): void { this.log("debug", msg, ctx); }
  info(msg: string, ctx?: LogContext): void { this.log("info", msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.log("warn", msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.log("error", msg, ctx); }

  child(name: string): Logger {
    const level = Object.entries(LEVEL_ORDER).find(([, v]) => v === this.min_level)?.[0] as LogLevel || "info";
    return new ConsoleLogger(name, level);
  }

  private log(level: LogLevel, msg: string, ctx?: LogContext): void {
    if (LEVEL_ORDER[level] < this.min_level) return;
    const line = `${this.prefix} ${msg}${format_ctx(ctx)}`;
    if (level === "error") {
       
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

const _log_level = parse_log_level(process.env.LOG_LEVEL);

export function create_logger(name: string): Logger {
  return new ConsoleLogger(name, _log_level);
}
