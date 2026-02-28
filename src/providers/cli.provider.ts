import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { BaseLlmProvider } from "./base.js";
import { LlmResponse, type ChatOptions, type ProviderId } from "./types.js";
import {
  DEFAULT_CAPTURE_MAX_CHARS,
  DEFAULT_STREAM_STATE_MAX_CHARS,
  extract_final_from_json_output,
  extract_json_event_text,
  extract_protocol_output,
  extract_protocol_partial,
  messages_to_prompt,
  parse_json_line,
  parse_tool_calls_from_output,
  strip_protocol_scaffold,
} from "./cli-protocol.js";
import {
  is_claude_command,
  is_codex_command,
  split_args,
  split_command_with_embedded_args,
  strip_approval_flags,
  strip_surrounding_quotes,
  with_claude_permission_overrides,
  with_codex_mcp_runtime_overrides,
  with_codex_permission_overrides,
} from "./cli-permission.js";

export { __cli_provider_test__ } from "./cli-protocol.js";

function append_limited(base: string, incoming: string, max_chars: number): string {
  const max = Math.max(1_000, Number(max_chars || DEFAULT_CAPTURE_MAX_CHARS));
  const merged = `${base}${incoming}`;
  if (merged.length <= max) return merged;
  const half = Math.floor((max - 60) / 2);
  return `${merged.slice(0, half)}\n...[truncated ${merged.length - max} chars]...\n${merged.slice(merged.length - half)}`;
}

function count_replacement_chars(text: string): number {
  return (text.match(/\uFFFD/g) || []).length;
}

function decode_chunk(chunk: unknown): string {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""));
  const utf8 = buf.toString("utf8");
  const utf8_bad = count_replacement_chars(utf8);
  if (utf8_bad === 0) return utf8;
  try {
    const euckr = new TextDecoder("euc-kr").decode(buf);
    const euckr_bad = count_replacement_chars(euckr);
    return euckr_bad <= utf8_bad ? euckr : utf8;
  } catch {
    return utf8;
  }
}

function resolve_command_for_windows(command: string): string {
  if (process.platform !== "win32") return command;
  const cmd = strip_surrounding_quotes(String(command || "").trim());
  if (!cmd) return cmd;
  if (/[/\\]/.test(cmd) || /\.[A-Za-z0-9]+$/.test(cmd)) return cmd;

  if (cmd.toLowerCase() === "codex") {
    const appData = String(process.env.APPDATA || "").trim();
    const candidates = [
      appData ? join(appData, "npm", "codex.cmd") : "",
      appData ? join(appData, "npm", "codex.exe") : "",
      appData ? join(appData, "npm", "codex") : "",
      "codex.cmd",
      "codex.exe",
    ].filter(Boolean);
    for (const c of candidates) {
      if (/[\\/]/.test(c) && existsSync(c)) return c;
      if (!/[\\/]/.test(c)) return c;
    }
    return "codex.cmd";
  }
  if (cmd.toLowerCase() === "claude") {
    return "claude.exe";
  }
  return cmd;
}

async function run_cli(
  command: string,
  args: string[],
  prompt: string,
  timeout_ms: number,
  abort_signal?: AbortSignal,
  on_chunk?: (chunk: string) => void | Promise<void>,
  capture_max_chars = DEFAULT_CAPTURE_MAX_CHARS,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const resolved = resolve_command_for_windows(command);
  const use_cmd_wrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);

  // 중첩 세션 감지 방지: CLAUDECODE 환경변수를 자식 프로세스에 전달하지 않음
  const child_env = { ...process.env };
  delete child_env.CLAUDECODE;

  return new Promise((resolve) => {
    const child = use_cmd_wrapper
      ? spawn("cmd.exe", ["/d", "/s", "/c", strip_surrounding_quotes(resolved), ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
          env: child_env,
        })
      : spawn(resolved, args, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
          env: child_env,
        });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      abort_signal?.removeEventListener("abort", on_abort);
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\ncli_timeout_${timeout_ms}ms`.trim(), code: null });
    }, timeout_ms);
    const on_abort = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, stdout, stderr: `${stderr}\naborted_by_user`.trim(), code: null });
    };
    abort_signal?.addEventListener("abort", on_abort, { once: true });

    child.stdout.on("data", (chunk) => {
      const text = decode_chunk(chunk);
      stdout = append_limited(stdout, text, capture_max_chars);
      if (on_chunk) void Promise.resolve(on_chunk(text)).catch(() => {});
    });
    child.stderr.on("data", (chunk) => {
      const text = decode_chunk(chunk);
      stderr = append_limited(stderr, text, capture_max_chars);
      if (on_chunk) void Promise.resolve(on_chunk(text)).catch(() => {});
    });
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort_signal?.removeEventListener("abort", on_abort);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${error.message}`.trim(), code: null });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort_signal?.removeEventListener("abort", on_abort);
      resolve({ ok: code === 0, stdout, stderr, code });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export class CliHeadlessProvider extends BaseLlmProvider {
  private readonly command_env: string;
  private readonly args_env: string;
  private readonly timeout_env: string;
  private readonly default_command: string;
  private readonly default_args: string;
  private readonly default_timeout_ms: number;

  constructor(args: {
    id: ProviderId;
    api_base?: string;
    default_model: string;
    command_env: string;
    args_env: string;
    timeout_env: string;
    default_command: string;
    default_args?: string;
    default_timeout_ms?: number;
  }) {
    super({
      id: args.id,
      api_base: args.api_base ?? "cli://local",
      default_model: args.default_model,
      supports_tool_loop: true,
    });
    this.command_env = args.command_env;
    this.args_env = args.args_env;
    this.timeout_env = args.timeout_env;
    this.default_command = args.default_command;
    this.default_args = args.default_args || "";
    this.default_timeout_ms = args.default_timeout_ms || 180000;
  }

  async chat(options: ChatOptions): Promise<LlmResponse> {
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const prompt = messages_to_prompt(this.sanitize_messages(options.messages), tools);
    const command_env_value = String(process.env[this.command_env] || this.default_command).trim();
    const normalized = split_command_with_embedded_args(command_env_value);
    const command = normalized.command;
    if (!command) {
      return new LlmResponse({
        content: `Error calling ${this.id}: env_missing:${this.command_env}`,
        finish_reason: "error",
      });
    }

    const raw_args = String(process.env[this.args_env] || this.default_args).trim();
    let args = strip_approval_flags([...normalized.args, ...split_args(raw_args)]);
    // Safe default for codex headless: force non-interactive exec mode.
    if (is_codex_command(command) && args.length === 0) {
      args = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"];
    }
    // Safe default for claude headless: force print mode from stdin.
    if (is_claude_command(command) && args.length === 0) {
      args = ["-p", "--output-format", "text", "--permission-mode", "dontAsk", "-"];
    }
    args = with_codex_permission_overrides(command, args, options.runtime_policy);
    args = with_claude_permission_overrides(command, args, options.runtime_policy);
    args = with_codex_mcp_runtime_overrides(command, args, options.runtime_policy);
    const timeout_ms = Math.max(1000, Number(process.env[this.timeout_env] || this.default_timeout_ms));
    const capture_max_chars = Math.max(
      10_000,
      Number(process.env.CLI_PROVIDER_MAX_CAPTURE_CHARS || DEFAULT_CAPTURE_MAX_CHARS),
    );
    const stream_state_max_chars = Math.max(
      8_000,
      Number(process.env.CLI_PROVIDER_MAX_STREAM_STATE_CHARS || DEFAULT_STREAM_STATE_MAX_CHARS),
    );
    const json_mode = args.includes("--json") || raw_args.includes("stream-json");
    let streamed_partial = "";
    let raw_stream = "";
    let json_line_buffer = "";
    let final_from_json = "";
    let saw_json_event = false;
    const json_state = { last_full_text: "" };
    let last_emitted_chunk_key = "";
    let last_emitted_chunk_at = 0;
    const emit_stream = async (raw: string): Promise<void> => {
      const clean = strip_protocol_scaffold(raw);
      if (!clean) return;
      const key = clean.replace(/\s+/g, " ").trim().toLowerCase();
      if (!key) return;
      const now = Date.now();
      if (key === last_emitted_chunk_key && now - last_emitted_chunk_at < 30_000) return;
      last_emitted_chunk_key = key;
      last_emitted_chunk_at = now;
      await options.on_stream?.(clean);
    };
    const on_chunk = options.on_stream
      ? async (chunk: string) => {
          const incoming = String(chunk || "");
          if (!incoming) return;

          if (json_mode || saw_json_event) {
            json_line_buffer = append_limited(json_line_buffer, incoming, stream_state_max_chars);
            while (true) {
              const idx = json_line_buffer.indexOf("\n");
              if (idx < 0) break;
              const line = json_line_buffer.slice(0, idx).trim();
              json_line_buffer = json_line_buffer.slice(idx + 1);
              if (!line) continue;
              const parsed = parse_json_line(line);
              if (!parsed) continue;
              saw_json_event = true;
              const extracted = extract_json_event_text(parsed, json_state);
              if (extracted.final && extracted.final.trim()) {
                final_from_json = strip_protocol_scaffold(extracted.final);
              }
              if (extracted.delta && extracted.delta.trim()) {
                await emit_stream(extracted.delta);
              }
            }
            return;
          }

          raw_stream = append_limited(raw_stream, incoming, stream_state_max_chars);
          const partial = extract_protocol_partial(raw_stream);
          if (!partial) return;
          if (partial.length <= streamed_partial.length) return;
          const delta = partial.slice(streamed_partial.length);
          streamed_partial = partial;
          await emit_stream(delta);
        }
      : undefined;

    const result = await run_cli(
      command,
      args,
      prompt,
      timeout_ms,
      options.abort_signal,
      on_chunk,
      capture_max_chars,
    );
    if (!result.ok) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const raw_combined = [stderr, stdout].filter(Boolean).join(" | ");
      const reason = (raw_combined.length > 2000 ? raw_combined.slice(0, 2000) + "..." : raw_combined) || `exit_code_${String(result.code)}`;
      return new LlmResponse({
        content: `Error calling ${this.id}: ${reason}`,
        finish_reason: "error",
      });
    }
    const merged_output = `${result.stdout}\n${result.stderr}`;
    const tool_calls = parse_tool_calls_from_output(merged_output);
    if (tool_calls.length > 0) {
      return new LlmResponse({
        content: null,
        tool_calls,
        finish_reason: "tool_calls",
      });
    }
    const jsonText = extract_final_from_json_output(merged_output) || final_from_json;
    const protocolText = extract_protocol_output(result.stdout) || extract_protocol_output(result.stderr);
    const text = strip_protocol_scaffold(String(jsonText || protocolText || result.stdout || result.stderr || ""));
    if (!text) {
      return new LlmResponse({
        content: `Error calling ${this.id}: no_protocol_output`,
        finish_reason: "error",
      });
    }
    return new LlmResponse({
      content: text || null,
      finish_reason: "stop",
    });
  }
}
