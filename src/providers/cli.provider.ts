import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { BaseLlmProvider } from "./base.js";
import { LlmResponse, type ChatMessage, type ChatOptions, type ProviderId } from "./types.js";

const OUTPUT_BLOCK_START = "<<ORCH_FINAL>>";
const OUTPUT_BLOCK_END = "<<ORCH_FINAL_END>>";
const DEFAULT_CAPTURE_MAX_CHARS = 500_000;
const DEFAULT_STREAM_STATE_MAX_CHARS = 200_000;

function messages_to_prompt(messages: ChatMessage[]): string {
  const base = messages
    .map((m) => {
      const role = String(m.role || "user").toUpperCase();
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return `[${role}] ${content}`;
    })
    .join("\n\n");
  const protocol = [
    "",
    "[SYSTEM]",
    "Return only the final user-facing answer wrapped in the exact block below.",
    "Start your response with the start marker immediately, stream the answer body, then close with end marker.",
    "Do not include execution logs, shell commands, env vars, or debug info.",
    OUTPUT_BLOCK_START,
    "<final answer>",
    OUTPUT_BLOCK_END,
  ].join("\n");
  return `${base}\n${protocol}`.trim();
}

function extract_protocol_output(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const escapedStart = OUTPUT_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = OUTPUT_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g");
  let match: RegExpExecArray | null = null;
  let last = "";
  while (true) {
    match = re.exec(text);
    if (!match) break;
    last = String(match[1] || "").trim();
  }
  return last;
}

function extract_protocol_partial(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const start_idx = text.indexOf(OUTPUT_BLOCK_START);
  if (start_idx < 0) return "";
  const body_start = start_idx + OUTPUT_BLOCK_START.length;
  const end_idx = text.indexOf(OUTPUT_BLOCK_END, body_start);
  if (end_idx >= 0) return text.slice(body_start, end_idx);
  return text.slice(body_start);
}

function split_args(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function append_limited(base: string, incoming: string, max_chars: number): string {
  const max = Math.max(1_000, Number(max_chars || DEFAULT_CAPTURE_MAX_CHARS));
  const merged = `${base}${incoming}`;
  if (merged.length <= max) return merged;
  return merged.slice(merged.length - max);
}

function count_replacement_chars(text: string): number {
  return (text.match(/�/g) || []).length;
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

function as_string(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function collect_text_deep(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((v) => collect_text_deep(v, depth + 1))
      .filter(Boolean)
      .join("");
  }
  if (!value || typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  const direct = as_string(rec.text) || as_string(rec.value);
  if (direct) return direct;
  if (rec.delta && typeof rec.delta === "object") {
    const d = rec.delta as Record<string, unknown>;
    const delta_text = as_string(d.text) || as_string(d.value);
    if (delta_text) return delta_text;
  }
  if (rec.message && typeof rec.message === "object") {
    const message = rec.message as Record<string, unknown>;
    const from_message = collect_text_deep(message.content, depth + 1) || as_string(message.text);
    if (from_message) return from_message;
  }
  if (rec.content) {
    const from_content = collect_text_deep(rec.content, depth + 1);
    if (from_content) return from_content;
  }
  return "";
}

function parse_json_line(line: string): Record<string, unknown> | null {
  const raw = String(line || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extract_json_event_text(
  event: Record<string, unknown>,
  state: { last_full_text: string },
): { delta?: string; final?: string } {
  const type = as_string(event.type).toLowerCase();
  if (!type) return {};

  if (type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    const item_type = as_string(item.type).toLowerCase();
    const text = collect_text_deep(item);
    if (!text) return {};
    if (item_type === "agent_message" || item_type === "assistant_message" || item_type === "message") {
      const full = text.trim();
      if (!full) return {};
      let delta = full;
      if (state.last_full_text && full.startsWith(state.last_full_text)) {
        delta = full.slice(state.last_full_text.length);
      }
      state.last_full_text = full;
      return { delta, final: full };
    }
    if (item_type === "reasoning") {
      return { delta: `… ${text.trim()}` };
    }
  }

  if (type.includes("delta")) {
    const delta = collect_text_deep(event);
    if (delta && delta.trim()) return { delta };
    return {};
  }

  if (type.includes("message.completed") || type === "assistant") {
    const full = collect_text_deep(event).trim();
    if (!full) return {};
    let delta = full;
    if (state.last_full_text && full.startsWith(state.last_full_text)) {
      delta = full.slice(state.last_full_text.length);
    }
    state.last_full_text = full;
    return { delta, final: full };
  }

  return {};
}

function extract_final_from_json_output(raw: string): string {
  const state = { last_full_text: "" };
  let out = "";
  const lines = String(raw || "").split(/\r?\n/g);
  for (const line of lines) {
    const parsed = parse_json_line(line);
    if (!parsed) continue;
    const extracted = extract_json_event_text(parsed, state);
    if (extracted.final && extracted.final.trim()) out = extracted.final.trim();
  }
  return out;
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
  return new Promise((resolve) => {
    const child = use_cmd_wrapper
      ? spawn("cmd.exe", ["/d", "/s", "/c", strip_surrounding_quotes(resolved), ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        })
      : spawn(resolved, args, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
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

function strip_surrounding_quotes(v: string): string {
  const s = String(v || "").trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
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
    });
    this.command_env = args.command_env;
    this.args_env = args.args_env;
    this.timeout_env = args.timeout_env;
    this.default_command = args.default_command;
    this.default_args = args.default_args || "";
    this.default_timeout_ms = args.default_timeout_ms || 180000;
  }

  async chat(options: ChatOptions): Promise<LlmResponse> {
    const prompt = messages_to_prompt(this.sanitize_messages(options.messages));
    const command = String(process.env[this.command_env] || this.default_command).trim();
    if (!command) {
      return new LlmResponse({
        content: `Error calling ${this.id}: env_missing:${this.command_env}`,
        finish_reason: "error",
      });
    }

    const raw_args = String(process.env[this.args_env] || this.default_args).trim();
    let args = split_args(raw_args);
    // Safe default for codex headless: force non-interactive exec mode.
    if (/^codex(\.exe)?$/i.test(command) && args.length === 0) {
      args = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"];
    }
    // Safe default for claude headless: force print mode from stdin.
    if (/^claude(\.exe)?$/i.test(command) && args.length === 0) {
      args = ["-p", "--output-format", "text", "--permission-mode", "dontAsk", "-"];
    }
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
    let preprotocol_buffer = "";
    let last_preprotocol_emit_at = 0;
    let json_line_buffer = "";
    let final_from_json = "";
    let saw_json_event = false;
    const json_state = { last_full_text: "" };
    const result = await run_cli(
      command,
      args,
      prompt,
      timeout_ms,
      options.abort_signal,
      options.on_stream
        ? async (chunk) => {
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
                if (!parsed) {
                  if (!saw_json_event && line.trim()) {
                    await options.on_stream?.(line);
                  }
                  continue;
                }
                saw_json_event = true;
                const extracted = extract_json_event_text(parsed, json_state);
                if (extracted.final && extracted.final.trim()) {
                  final_from_json = extracted.final.trim();
                }
                if (extracted.delta && extracted.delta.trim()) {
                  await options.on_stream?.(extracted.delta);
                }
              }
              return;
            }

            raw_stream = append_limited(raw_stream, incoming, stream_state_max_chars);
            const partial = extract_protocol_partial(raw_stream);
            if (!partial) {
              preprotocol_buffer = append_limited(preprotocol_buffer, incoming, stream_state_max_chars);
              const now = Date.now();
              if (preprotocol_buffer.length < 120 && now - last_preprotocol_emit_at < 1200) return;
              const out = preprotocol_buffer;
              preprotocol_buffer = "";
              last_preprotocol_emit_at = now;
              if (out.trim().length === 0) return;
              await options.on_stream?.(out);
              return;
            }
            preprotocol_buffer = "";
            if (partial.length <= streamed_partial.length) return;
            const delta = partial.slice(streamed_partial.length);
            streamed_partial = partial;
            if (delta.trim().length === 0) return;
            await options.on_stream?.(delta);
          }
        : undefined,
      capture_max_chars,
    );
    if (!result.ok) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const combined = [stderr, stdout].filter(Boolean).join(" | ");
      const reason = combined || `exit_code_${String(result.code)}`;
      return new LlmResponse({
        content: `Error calling ${this.id}: ${reason}`,
        finish_reason: "error",
      });
    }
    const jsonText = extract_final_from_json_output(`${result.stdout}\n${result.stderr}`) || final_from_json;
    const protocolText = extract_protocol_output(result.stdout) || extract_protocol_output(result.stderr);
    const text = String(jsonText || protocolText || result.stdout || result.stderr || "").trim();
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
