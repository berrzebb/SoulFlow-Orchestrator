/** Log Parser 도구 — 구조화 로그 파싱 (JSON, Apache, Nginx, syslog, custom). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class LogParserTool extends Tool {
  readonly name = "log_parser";
  readonly category = "data" as const;
  readonly description = "Log parsing: parse_json, parse_apache, parse_nginx, parse_syslog, parse_custom, filter, stats, tail.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse_json", "parse_apache", "parse_nginx", "parse_syslog", "parse_custom", "filter", "stats", "tail"], description: "Log operation" },
      input: { type: "string", description: "Log content (multi-line)" },
      pattern: { type: "string", description: "Regex pattern with named groups for parse_custom" },
      field: { type: "string", description: "Field name for filter" },
      value: { type: "string", description: "Value for filter matching" },
      level: { type: "string", description: "Minimum log level for filter (debug/info/warn/error/fatal)" },
      count: { type: "integer", description: "Number of lines for tail (default: 20)" },
    },
    required: ["action", "input"],
    additionalProperties: false,
  };

  private readonly APACHE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) (\d+|-)/;
  private readonly NGINX_RE = /^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) (\d+) "([^"]*)" "([^"]*)"/;
  private readonly SYSLOG_RE = /^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}) (\S+) (\S+?)(?:\[(\d+)\])?: (.+)/;
  private readonly LEVEL_ORDER: Record<string, number> = { debug: 0, trace: 0, info: 1, warn: 2, warning: 2, error: 3, fatal: 4, critical: 4 };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse_json");
    const input = String(params.input || "");
    const lines = input.split("\n").filter((l) => l.trim());

    switch (action) {
      case "parse_json": {
        const records = lines.map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        return JSON.stringify({ records, count: records.length, errors: lines.length - records.length });
      }
      case "parse_apache": {
        const records = lines.map((line) => {
          const m = this.APACHE_RE.exec(line);
          if (!m) return null;
          return { ip: m[1], timestamp: m[2], method: m[3], path: m[4], status: Number(m[5]), size: m[6] === "-" ? 0 : Number(m[6]) };
        }).filter(Boolean);
        return JSON.stringify({ records, count: records.length });
      }
      case "parse_nginx": {
        const records = lines.map((line) => {
          const m = this.NGINX_RE.exec(line);
          if (!m) return null;
          return { ip: m[1], user: m[2], timestamp: m[3], method: m[4], path: m[5], status: Number(m[6]), size: Number(m[7]), referer: m[8], user_agent: m[9] };
        }).filter(Boolean);
        return JSON.stringify({ records, count: records.length });
      }
      case "parse_syslog": {
        const records = lines.map((line) => {
          const m = this.SYSLOG_RE.exec(line);
          if (!m) return null;
          return { timestamp: m[1], host: m[2], program: m[3], pid: m[4] ? Number(m[4]) : null, message: m[5] };
        }).filter(Boolean);
        return JSON.stringify({ records, count: records.length });
      }
      case "parse_custom": {
        const pattern = String(params.pattern || "");
        if (!pattern) return "Error: pattern is required";
        let re: RegExp;
        try { re = new RegExp(pattern); } catch { return "Error: invalid regex pattern"; }
        const records = lines.map((line) => {
          const m = re.exec(line);
          if (!m) return null;
          return m.groups || { match: m[0], groups: m.slice(1) };
        }).filter(Boolean);
        return JSON.stringify({ records, count: records.length });
      }
      case "filter": {
        const field = String(params.field || "");
        const value = String(params.value || "");
        const level = params.level ? String(params.level).toLowerCase() : null;
        const records = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
        const filtered = records.filter((r: Record<string, unknown>) => {
          if (level) {
            const rec_level = String(r.level || r.severity || "info").toLowerCase();
            if ((this.LEVEL_ORDER[rec_level] ?? 1) < (this.LEVEL_ORDER[level] ?? 0)) return false;
          }
          if (field && value) return String(r[field]) === value;
          if (field) return r[field] !== undefined && r[field] !== null;
          return true;
        });
        return JSON.stringify({ records: filtered, count: filtered.length, total: records.length });
      }
      case "stats": {
        const records = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
        const levels: Record<string, number> = {};
        for (const r of records) {
          const lvl = String((r as Record<string, unknown>).level || (r as Record<string, unknown>).severity || "unknown").toLowerCase();
          levels[lvl] = (levels[lvl] || 0) + 1;
        }
        return JSON.stringify({ total: records.length, parse_errors: lines.length - records.length, by_level: levels });
      }
      case "tail": {
        const count = Math.max(1, Number(params.count) || 20);
        const tail_lines = lines.slice(-count);
        const records = tail_lines.map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
        return JSON.stringify({ records, count: records.length });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }
}
