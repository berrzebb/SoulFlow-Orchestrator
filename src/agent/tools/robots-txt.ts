/** robots.txt 도구 — robots.txt 생성/파싱/검증. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface RobotsRule {
  user_agent: string;
  allow: string[];
  disallow: string[];
  crawl_delay?: number;
}

export class RobotsTxtTool extends Tool {
  readonly name = "robots_txt";
  readonly category = "data" as const;
  readonly description = "robots.txt utilities: generate, parse, check, validate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "parse", "check", "validate"], description: "Operation" },
      rules: { type: "string", description: "JSON array of rules [{user_agent, allow, disallow, crawl_delay?}]" },
      robots: { type: "string", description: "robots.txt content (parse/check/validate)" },
      sitemap: { type: "string", description: "Sitemap URL to include" },
      path: { type: "string", description: "URL path to check" },
      user_agent: { type: "string", description: "User-agent to check against" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");

    switch (action) {
      case "generate": {
        let rules: RobotsRule[];
        try { rules = JSON.parse(String(params.rules || '[{"user_agent":"*","allow":["/"],"disallow":[]}]')); } catch { return JSON.stringify({ error: "invalid rules JSON" }); }
        const lines: string[] = [];
        for (const rule of rules) {
          lines.push(`User-agent: ${rule.user_agent}`);
          for (const a of rule.allow || []) lines.push(`Allow: ${a}`);
          for (const d of rule.disallow || []) lines.push(`Disallow: ${d}`);
          if (rule.crawl_delay) lines.push(`Crawl-delay: ${rule.crawl_delay}`);
          lines.push("");
        }
        if (params.sitemap) lines.push(`Sitemap: ${params.sitemap}`);
        return lines.join("\n").trim();
      }
      case "parse": {
        const content = String(params.robots || "");
        return JSON.stringify(this.parse_robots(content));
      }
      case "check": {
        const content = String(params.robots || "");
        const path = String(params.path || "/");
        const ua = String(params.user_agent || "*");
        const parsed = this.parse_robots(content);
        const allowed = this.is_allowed(parsed, path, ua);
        return JSON.stringify({ path, user_agent: ua, allowed });
      }
      case "validate": {
        const content = String(params.robots || "");
        const errors: string[] = [];
        const lines = content.split(/\r?\n/);
        let has_ua = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith("#")) continue;
          const colon = line.indexOf(":");
          if (colon < 0) { errors.push(`line ${i + 1}: missing colon`); continue; }
          const directive = line.slice(0, colon).trim().toLowerCase();
          const known = ["user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host"];
          if (!known.includes(directive)) errors.push(`line ${i + 1}: unknown directive '${directive}'`);
          if (directive === "user-agent") has_ua = true;
          if ((directive === "allow" || directive === "disallow") && !has_ua) errors.push(`line ${i + 1}: ${directive} before User-agent`);
        }
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_robots(content: string): { rules: RobotsRule[]; sitemaps: string[] } {
    const rules: RobotsRule[] = [];
    const sitemaps: string[] = [];
    let current: RobotsRule | null = null;
    for (const raw_line of content.split(/\r?\n/)) {
      const line = raw_line.split("#")[0].trim();
      if (!line) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (key === "user-agent") {
        current = { user_agent: value, allow: [], disallow: [] };
        rules.push(current);
      } else if (key === "allow" && current) {
        current.allow.push(value);
      } else if (key === "disallow" && current) {
        current.disallow.push(value);
      } else if (key === "crawl-delay" && current) {
        current.crawl_delay = Number(value) || undefined;
      } else if (key === "sitemap") {
        sitemaps.push(value);
      }
    }
    return { rules, sitemaps };
  }

  private is_allowed(parsed: { rules: RobotsRule[] }, path: string, ua: string): boolean {
    const matching = parsed.rules.filter((r) => r.user_agent === ua || r.user_agent === "*");
    if (matching.length === 0) return true;
    for (const rule of matching) {
      for (const d of rule.disallow) {
        if (d && path.startsWith(d)) {
          const explicitly_allowed = rule.allow.some((a) => path.startsWith(a) && a.length > d.length);
          if (!explicitly_allowed) return false;
        }
      }
    }
    return true;
  }
}
