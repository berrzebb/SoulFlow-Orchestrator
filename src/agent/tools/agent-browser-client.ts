/** agentBrowser CLI 공통 클라이언트. web/web-table/web-form/web-auth/screenshot 도구에서 공유. */

import { error_message } from "../../utils/common.js";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const exec_file_async = promisify(execFile);

let cached_bin: string | null | undefined;

export function detect_agent_browser_binary(): string | null {
  if (cached_bin !== undefined) return cached_bin;
  const bin = process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";
  const checker = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(checker, [bin], { stdio: "ignore", windowsHide: true, shell: false });
  cached_bin = r.status === 0 ? bin : null;
  return cached_bin;
}

export function parse_last_json_line(raw: string): Record<string, unknown> | null {
  const lines = String(raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* next */ }
  }
  return null;
}

function quote_cmd_arg(arg: string): string {
  return `"${String(arg).replace(/"/g, '""').replace(/%/g, "%%")}"`;
}

export type AgentBrowserResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  parsed: Record<string, unknown> | null;
  reason?: string;
};

export async function run_agent_browser(
  args: string[],
  opts?: { signal?: AbortSignal; timeout_ms?: number },
): Promise<AgentBrowserResult> {
  const bin = detect_agent_browser_binary();
  if (!bin) return { ok: false, stdout: "", stderr: "", parsed: null, reason: "agent_browser_not_installed" };

  const timeout_ms = opts?.timeout_ms ?? 90_000;
  try {
    const cmd = process.platform === "win32" ? "cmd.exe" : bin;
    const cmd_args = process.platform === "win32"
      ? ["/d", "/s", "/c", [bin, ...args.map(quote_cmd_arg)].join(" ")]
      : args;
    const r = await exec_file_async(cmd, cmd_args, {
      timeout: timeout_ms,
      maxBuffer: 1024 * 1024 * 16,
      signal: opts?.signal,
      windowsHide: true,
    });
    const stdout = String(r.stdout || "");
    const stderr = String(r.stderr || "");
    return { ok: true, stdout, stderr, parsed: parse_last_json_line(`${stdout}\n${stderr}`) };
  } catch (error) {
    const e = (error || {}) as Record<string, unknown>;
    const stdout = String(e.stdout || "");
    const stderr = String(e.stderr || error_message(error));
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    const missing = combined.includes("spawn agent-browser")
      || combined.includes("enoent")
      || combined.includes("not recognized as an internal or external command")
      || combined.includes("is not recognized as a name of a cmdlet");
    return {
      ok: false, stdout, stderr,
      parsed: parse_last_json_line(`${stdout}\n${stderr}`),
      reason: missing ? "agent_browser_not_installed" : "agent_browser_exec_failed",
    };
  }
}

export function agent_browser_error(result: AgentBrowserResult, fallback: string): string {
  if (result.reason === "agent_browser_not_installed") {
    return "Error: agent_browser_not_installed (install: npm i -g agent-browser && agent-browser install)";
  }
  return `Error: ${result.stderr || result.stdout || fallback}`;
}

export function parsed_browser_data(result: AgentBrowserResult): Record<string, unknown> {
  const data = result.parsed?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

export function compact_session_name(explicit?: string, channel?: string, chat_id?: string): string {
  const manual = (explicit || "").trim();
  if (manual) return manual.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "default";
  const merged = `${(channel || "default").trim().toLowerCase()}-${(chat_id || "default").trim().toLowerCase()}`;
  return merged.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "default";
}
