import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

function strip_html_tags(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validate_url(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `invalid_protocol:${parsed.protocol}`;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^169\.254\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)
    ) {
      return "blocked_private_host";
    }
    return null;
  } catch {
    return "invalid_url";
  }
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?previous\s+instructions\b/i,
  /\bdisregard\s+(the\s+)?(system|developer)\s+prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(system|developer)\s+message\b/i,
  /\breveal\s+(your\s+)?(prompt|instructions)\b/i,
  /\bcall\s+the\s+tool\b/i,
  /\bexecute\s+(this|the)\s+command\b/i,
  /\brun\s+this\s+(shell|bash|powershell)\b/i,
  /\bcopy\s+and\s+paste\b/i,
  /\bdo\s+not\s+summari[sz]e\b/i,
];

function sanitize_untrusted_text(input: string): {
  text: string;
  suspicious_lines: number;
  removed_lines: string[];
} {
  const lines = String(input || "").split(/\r?\n/);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    const suspicious = PROMPT_INJECTION_PATTERNS.some((p) => p.test(trimmed));
    if (suspicious) {
      removed.push(trimmed.slice(0, 200));
      continue;
    }
    kept.push(line);
  }
  return {
    text: kept.join("\n").trim(),
    suspicious_lines: removed.length,
    removed_lines: removed.slice(0, 20),
  };
}

export class WebSearchTool extends Tool {
  readonly name = "web_search";
  readonly description = "Search web snippets using DuckDuckGo instant answer API.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "integer", minimum: 1, maximum: 20, description: "Max result count" },
    },
    required: ["query"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const query = String(params.query || "").trim();
    const count = Math.max(1, Math.min(20, Number(params.count || 5)));
    if (!query) return "Error: query is required";
    if (context?.signal?.aborted) return "Error: cancelled";
    try {
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_redirect", "1");
      url.searchParams.set("no_html", "1");
      const response = await fetch(url, { signal: context?.signal });
      if (!response.ok) return `Error: HTTP ${response.status}`;
      const data = (await response.json()) as Record<string, unknown>;
      const lines: string[] = [`Results for: ${query}`];
      const heading = String(data.Heading || "").trim();
      const abstract = String(data.AbstractText || "").trim();
      const abstract_url = String(data.AbstractURL || "").trim();
      if (heading || abstract) {
        lines.push(`1. ${heading || query}`);
        if (abstract_url) lines.push(`   ${abstract_url}`);
        if (abstract) lines.push(`   ${abstract}`);
      }
      const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
      let index = lines.length > 1 ? 2 : 1;
      for (const item of related) {
        if (index > count) break;
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (Array.isArray(row.Topics)) {
          for (const nested of row.Topics) {
            if (index > count) break;
            if (!nested || typeof nested !== "object") continue;
            const nested_row = nested as Record<string, unknown>;
            const text = String(nested_row.Text || "").trim();
            const first_url = String(nested_row.FirstURL || "").trim();
            if (!text) continue;
            lines.push(`${index}. ${text}`);
            if (first_url) lines.push(`   ${first_url}`);
            index += 1;
          }
          continue;
        }
        const text = String(row.Text || "").trim();
        const first_url = String(row.FirstURL || "").trim();
        if (!text) continue;
        lines.push(`${index}. ${text}`);
        if (first_url) lines.push(`   ${first_url}`);
        index += 1;
      }
      if (lines.length === 1) return `No results for: ${query}`;
      const sanitized = sanitize_untrusted_text(lines.join("\n"));
      const header = sanitized.suspicious_lines > 0
        ? `[security] stripped ${sanitized.suspicious_lines} suspicious line(s) from search snippets`
        : "";
      return [header, sanitized.text].filter(Boolean).join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }
}

export class WebFetchTool extends Tool {
  readonly name = "web_fetch";
  readonly description = "Fetch a URL and return extracted text/markdown-like content.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "Target URL" },
      max_chars: { type: "integer", minimum: 100, maximum: 500000, description: "Max characters in output" },
    },
    required: ["url"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const url = String(params.url || "");
    const err = validate_url(url);
    if (err) return `Error: ${err}`;
    const max_chars = Math.max(100, Math.min(500_000, Number(params.max_chars || 50_000)));
    if (context?.signal?.aborted) return "Error: cancelled";
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "headless-orchestrator/0.1" },
        signal: context?.signal,
        redirect: "follow",
      });
      if (!response.ok) return `Error: HTTP ${response.status}`;
      const content_type = response.headers.get("content-type") || "";
      const raw = await response.text();
      const extracted = content_type.includes("html") ? strip_html_tags(raw) : raw;
      const sanitized = sanitize_untrusted_text(extracted);
      const clipped = sanitized.text.length > max_chars ? `${sanitized.text.slice(0, max_chars)}\n... (truncated)` : sanitized.text;
      return JSON.stringify(
        {
          url,
          final_url: response.url,
          status: response.status,
          content_type,
          length: clipped.length,
          security: {
            prompt_injection_suspected: sanitized.suspicious_lines > 0,
            stripped_lines: sanitized.suspicious_lines,
            stripped_preview: sanitized.removed_lines,
          },
          text: clipped,
        },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }
}
