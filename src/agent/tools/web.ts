import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

const exec_file_async = promisify(execFile);

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

let cached_agent_browser_bin: string | null | undefined;

function detect_agent_browser_binary(): string | null {
  if (cached_agent_browser_bin !== undefined) return cached_agent_browser_bin;
  const bin = process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";
  const checker = process.platform === "win32" ? "where" : "which";
  const checked = spawnSync(checker, [bin], {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  cached_agent_browser_bin = checked.status === 0 ? bin : null;
  return cached_agent_browser_bin;
}

function parse_last_json_line(raw: string): Record<string, unknown> | null {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      return parsed as Record<string, unknown>;
    } catch {
      // keep searching previous lines
    }
  }
  return null;
}

function quote_cmd_arg(arg: string): string {
  return `"${String(arg).replace(/"/g, "\"\"").replace(/%/g, "%%")}"`;
}

function compact_session_name(context?: ToolExecutionContext, explicit?: unknown): string {
  const manual = String(explicit || "").trim();
  if (manual) return manual.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "default";
  const channel = String(context?.channel || "default").trim().toLowerCase();
  const chat = String(context?.chat_id || "default").trim().toLowerCase();
  const merged = `${channel}-${chat}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return merged.slice(0, 64) || "default";
}

async function run_agent_browser_cli(
  args: string[],
  context?: ToolExecutionContext,
  timeout_ms = 90_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; parsed: Record<string, unknown> | null; reason?: string }> {
  const bin = detect_agent_browser_binary();
  if (!bin) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      parsed: null,
      reason: "agent_browser_not_installed",
    };
  }
  try {
    const command = process.platform === "win32" ? "cmd.exe" : bin;
    const command_args = process.platform === "win32"
      ? ["/d", "/s", "/c", [bin, ...args.map(quote_cmd_arg)].join(" ")]
      : args;
    const result = await exec_file_async(command, command_args, {
      timeout: timeout_ms,
      maxBuffer: 1024 * 1024 * 16,
      signal: context?.signal,
      windowsHide: true,
    });
    const stdout = String(result.stdout || "");
    const stderr = String(result.stderr || "");
    return {
      ok: true,
      stdout,
      stderr,
      parsed: parse_last_json_line(`${stdout}\n${stderr}`),
    };
  } catch (error) {
    const e = (error || {}) as Record<string, unknown>;
    const stdout = String(e.stdout || "");
    const stderr = String(e.stderr || (error instanceof Error ? error.message : String(error)));
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    const missing = combined.includes("spawn agent-browser")
      || combined.includes("enoent")
      || combined.includes("not recognized as an internal or external command")
      || combined.includes("is not recognized as a name of a cmdlet");
    return {
      ok: false,
      stdout,
      stderr,
      parsed: parse_last_json_line(`${stdout}\n${stderr}`),
      reason: missing ? "agent_browser_not_installed" : "agent_browser_exec_failed",
    };
  }
}

function agent_browser_error(
  result: { stdout: string; stderr: string; reason?: string },
  fallback_reason: string,
): string {
  if (result.reason === "agent_browser_not_installed") {
    return "Error: agent_browser_not_installed (install: npm i -g agent-browser && agent-browser install)";
  }
  return `Error: ${result.stderr || result.stdout || fallback_reason}`;
}

function parsed_browser_data(result: { parsed: Record<string, unknown> | null }): Record<string, unknown> {
  const parsed = result.parsed;
  if (!parsed) return {};
  const data = parsed.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

function clip_and_sanitize_text(input: string, max_chars: number): {
  text: string;
  security: {
    prompt_injection_suspected: boolean;
    stripped_lines: number;
    stripped_preview: string[];
  };
} {
  const sanitized = sanitize_untrusted_text(input);
  const clipped = sanitized.text.length > max_chars ? `${sanitized.text.slice(0, max_chars)}\n... (truncated)` : sanitized.text;
  return {
    text: clipped,
    security: {
      prompt_injection_suspected: sanitized.suspicious_lines > 0,
      stripped_lines: sanitized.suspicious_lines,
      stripped_preview: sanitized.removed_lines,
    },
  };
}

function extract_search_results(snapshot: string, count: number): Array<{ rank: number; ref: string | null; title: string }> {
  const lines = String(snapshot || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results: Array<{ rank: number; ref: string | null; title: string }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (results.length >= count) break;
    const title_match = line.match(/\blink\s+"([^"]+)"/i);
    if (!title_match) continue;
    const title = String(title_match[1] || "").trim();
    if (!title) continue;
    const ref_match = line.match(/\[ref=([^\]]+)\]/i);
    const ref = ref_match ? String(ref_match[1] || "").trim() : null;
    const key = `${title}::${ref || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ rank: results.length + 1, ref: ref || null, title });
  }
  return results;
}

export class WebSearchTool extends Tool {
  readonly name = "web_search";
  readonly description = "Search web results using agent-browser snapshot workflow.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "integer", minimum: 1, maximum: 20, description: "Max result count" },
      session: { type: "string", description: "Optional browser session name" },
      max_chars: { type: "integer", minimum: 100, maximum: 500000, description: "Max snapshot characters in output" },
    },
    required: ["query"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const query = String(params.query || "").trim();
    const count = Math.max(1, Math.min(20, Number(params.count || 5)));
    const max_chars = Math.max(100, Math.min(500_000, Number(params.max_chars || 20_000)));
    if (!query) return "Error: query is required";
    if (context?.signal?.aborted) return "Error: cancelled";
    const session = compact_session_name(context, params.session);
    const search_url = new URL("https://duckduckgo.com/");
    search_url.searchParams.set("q", query);
    search_url.searchParams.set("ia", "web");
    const base = ["--session", session];

    const open_result = await run_agent_browser_cli([...base, "open", search_url.toString(), "--json"], context);
    if (!open_result.ok) return agent_browser_error(open_result, "agent_browser_open_failed");
    await run_agent_browser_cli([...base, "wait", "--load", "domcontentloaded", "--json"], context, 15_000);
    const snapshot_result = await run_agent_browser_cli(
      [...base, "snapshot", "-i", "-c", "-d", "6", "--json"],
      context,
    );
    if (!snapshot_result.ok) return agent_browser_error(snapshot_result, "agent_browser_snapshot_failed");

    const data = parsed_browser_data(snapshot_result);
    const raw_snapshot = String(data.snapshot || "");
    const content = clip_and_sanitize_text(raw_snapshot, max_chars);
    const results = extract_search_results(content.text, count);

    return JSON.stringify(
      {
        query,
        session,
        engine: "duckduckgo",
        url: search_url.toString(),
        results,
        security: content.security,
        snapshot: content.text,
      },
      null,
      2,
    );
  }
}

export class WebFetchTool extends Tool {
  readonly name = "web_fetch";
  readonly description = "Fetch a web page using agent-browser and return extracted text.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "Target URL" },
      max_chars: { type: "integer", minimum: 100, maximum: 500000, description: "Max characters in output" },
      session: { type: "string", description: "Optional browser session name" },
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
    const session = compact_session_name(context, params.session);
    const base = ["--session", session];

    const open_result = await run_agent_browser_cli([...base, "open", url, "--json"], context);
    if (!open_result.ok) return agent_browser_error(open_result, "agent_browser_open_failed");
    await run_agent_browser_cli([...base, "wait", "--load", "domcontentloaded", "--json"], context, 15_000);

    let extracted = "";
    let refs: unknown = undefined;

    const get_text_result = await run_agent_browser_cli([...base, "get", "text", "body", "--json"], context);
    if (get_text_result.ok) {
      const data = parsed_browser_data(get_text_result);
      extracted = String(data.text || data.value || "").trim();
    }
    if (!extracted) {
      const snapshot_result = await run_agent_browser_cli([...base, "snapshot", "-c", "-d", "8", "--json"], context);
      if (!snapshot_result.ok) return agent_browser_error(snapshot_result, "agent_browser_snapshot_failed");
      const data = parsed_browser_data(snapshot_result);
      extracted = String(data.snapshot || "").trim();
      refs = data.refs;
    }
    const content = clip_and_sanitize_text(extracted, max_chars);
    return JSON.stringify(
      {
        url,
        session,
        engine: "agent-browser",
        length: content.text.length,
        security: content.security,
        refs,
        text: content.text,
      },
      null,
      2,
    );
  }
}

export class WebBrowserTool extends Tool {
  readonly name = "web_browser";
  readonly description = "Explore dynamic websites via agent-browser CLI (open/snapshot/click/fill/wait/get/screenshot/close).";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["open", "snapshot", "click", "fill", "wait", "get_text", "screenshot", "close"],
      },
      url: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
      wait_ms: { type: "integer", minimum: 1, maximum: 120000 },
      session: { type: "string" },
      path: { type: "string" },
      max_chars: { type: "integer", minimum: 100, maximum: 500000 },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "").trim().toLowerCase();
    if (!action) return "Error: action is required";
    const session = compact_session_name(context, params.session);
    const base = ["--session", session];

    if (action === "open") {
      const url = String(params.url || "").trim();
      if (!url) return "Error: url is required";
      const err = validate_url(url);
      if (err) return `Error: ${err}`;
      const result = await run_agent_browser_cli([...base, "open", url, "--json"], context);
      if (!result.ok) return agent_browser_error(result, "agent_browser_open_failed");
      return JSON.stringify({
        ok: true,
        session,
        action: "open",
        url,
      });
    }

    if (action === "snapshot") {
      const max_chars = Math.max(100, Math.min(500_000, Number(params.max_chars || 50_000)));
      const result = await run_agent_browser_cli([...base, "snapshot", "--json"], context);
      if (!result.ok) return agent_browser_error(result, "agent_browser_snapshot_failed");
      const data = parsed_browser_data(result);
      const raw_snapshot = String(data.snapshot || "");
      const refs = (data.refs && typeof data.refs === "object") ? data.refs : {};
      const content = clip_and_sanitize_text(raw_snapshot, max_chars);
      return JSON.stringify({
        session,
        action: "snapshot",
        security: content.security,
        refs,
        text: content.text,
      }, null, 2);
    }

    if (action === "click") {
      const selector = String(params.selector || "").trim();
      if (!selector) return "Error: selector is required";
      const result = await run_agent_browser_cli([...base, "click", selector, "--json"], context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_click_failed"}`;
      return JSON.stringify({ ok: true, session, action: "click", selector });
    }

    if (action === "fill") {
      const selector = String(params.selector || "").trim();
      const text = String(params.text || "");
      if (!selector) return "Error: selector is required";
      const result = await run_agent_browser_cli([...base, "fill", selector, text, "--json"], context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_fill_failed"}`;
      return JSON.stringify({ ok: true, session, action: "fill", selector });
    }

    if (action === "wait") {
      const selector = String(params.selector || "").trim();
      const wait_ms = Number(params.wait_ms || 0);
      if (!selector && !Number.isFinite(wait_ms)) return "Error: selector or wait_ms is required";
      const args = selector
        ? [...base, "wait", selector, "--json"]
        : [...base, "wait", String(Math.max(1, Math.round(wait_ms))), "--json"];
      const result = await run_agent_browser_cli(args, context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_wait_failed"}`;
      return JSON.stringify({ ok: true, session, action: "wait", selector: selector || null, wait_ms: selector ? null : Math.round(wait_ms) });
    }

    if (action === "get_text") {
      const selector = String(params.selector || "").trim();
      if (!selector) return "Error: selector is required";
      const result = await run_agent_browser_cli([...base, "get", "text", selector, "--json"], context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_get_text_failed"}`;
      return JSON.stringify({
        ok: true,
        session,
        action: "get_text",
        selector,
        data: result.parsed || null,
      }, null, 2);
    }

    if (action === "screenshot") {
      const path = String(params.path || "").trim();
      const args = path
        ? [...base, "screenshot", path, "--json"]
        : [...base, "screenshot", "--json"];
      const result = await run_agent_browser_cli(args, context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_screenshot_failed"}`;
      return JSON.stringify({
        ok: true,
        session,
        action: "screenshot",
        data: result.parsed || null,
      }, null, 2);
    }

    if (action === "close") {
      const result = await run_agent_browser_cli([...base, "close", "--json"], context);
      if (!result.ok) return `Error: ${result.stderr || result.stdout || "agent_browser_close_failed"}`;
      return JSON.stringify({ ok: true, session, action: "close" });
    }

    return `Error: unsupported action '${action}'`;
  }
}
