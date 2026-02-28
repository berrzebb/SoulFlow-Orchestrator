import { resolve } from "node:path";
import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { get_shared_secret_vault } from "../../security/secret-vault-factory.js";
import type { SecretVaultService } from "../../security/secret-vault.js";
import { redact_sensitive_text } from "../../security/sensitive.js";

type ShellToolOptions = {
  working_dir?: string;
  timeout_seconds?: number;
  deny_patterns?: string[];
  allow_patterns?: string[];
  restrict_to_working_dir?: boolean;
};

const DEFAULT_DENY_PATTERNS = [
  "\\brm\\s+-[rf]{1,2}\\b",
  "\\bdel\\s+/[fq]\\b",
  "\\brmdir\\s+/s\\b",
  "(?:^|[;&|]\\s*)format\\b",
  "\\b(mkfs|diskpart)\\b",
  "\\bdd\\s+if=",
  ">\\s*/dev/sd",
  "\\b(shutdown|reboot|poweroff)\\b",
  ":\\(\\)\\s*\\{.*\\};\\s*:",
  "\\b(base64|certutil|openssl)\\b[\\s\\S]{0,120}(?:--decode|-d|decode)[\\s\\S]{0,120}\\|\\s*(?:bash|sh|zsh|pwsh|powershell|cmd(?:\\.exe)?)\\b",
  "\\b(?:iex|invoke-expression)\\b",
];

const WRITE_APPROVAL_PATTERNS = [
  "\\becho\\b.*>",
  ">>",
  "\\btee\\b",
  "\\bset-content\\b",
  "\\badd-content\\b",
  "\\bout-file\\b",
  "\\bcopy-item\\b",
  "\\bmove-item\\b",
  "\\bnew-item\\b",
  "\\bremove-item\\b",
  "\\bmkdir\\b",
  "\\bmd\\b",
  "\\btouch\\b",
  "\\bcp\\b",
  "\\bmv\\b",
  "\\brm\\b",
  "\\bsed\\b.*-i",
  "\\bperl\\b.*-i",
  "\\bnpm\\s+(install|update|uninstall)\\b",
  "\\bcargo\\s+(add|remove)\\b",
  "\\bgit\\s+(commit|push|merge|rebase|cherry-pick|tag)\\b",
];

export class ExecTool extends Tool {
  readonly name = "exec";
  readonly description = "Execute a shell command and return stdout/stderr.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
      working_dir: { type: "string", description: "Optional working directory" },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 3600, description: "Timeout in seconds" },
    },
    required: ["command"],
    additionalProperties: false,
  };
  private readonly default_working_dir: string;
  private readonly timeout_seconds: number;
  private readonly deny_patterns: RegExp[];
  private readonly write_approval_patterns: RegExp[];
  private readonly allow_patterns: RegExp[];
  private readonly restrict_to_working_dir: boolean;
  private readonly secret_vault: SecretVaultService;

  constructor(options?: ShellToolOptions) {
    super();
    this.default_working_dir = options?.working_dir || process.cwd();
    this.timeout_seconds = Math.max(1, Number(options?.timeout_seconds || 60));
    this.deny_patterns = (options?.deny_patterns || DEFAULT_DENY_PATTERNS).map((p) => new RegExp(p, "i"));
    this.write_approval_patterns = WRITE_APPROVAL_PATTERNS.map((p) => new RegExp(p, "i"));
    this.allow_patterns = (options?.allow_patterns || []).map((p) => new RegExp(p, "i"));
    this.restrict_to_working_dir = Boolean(options?.restrict_to_working_dir);
    this.secret_vault = get_shared_secret_vault(this.default_working_dir);
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const command_raw = String(params.command || "").trim();
    const command = await this.secret_vault.resolve_placeholders(command_raw);
    // restrict_to_working_dir 시 LLM의 working_dir 오버라이드를 무시 — 항상 workspace 기준
    const cwd = this.restrict_to_working_dir
      ? this.default_working_dir
      : resolve(String(params.working_dir || this.default_working_dir));
    const timeout_seconds = Math.max(1, Number(params.timeout_seconds || this.timeout_seconds));
    const approved = params.__approved === true || String(params.__approved || "").trim().toLowerCase() === "true";
    const guard = this._guard_command(command, cwd);
    const approved_outside_workspace = Boolean(approved && guard && guard.kind === "approval_required");
    if (guard && !(guard.kind === "approval_required" && approved)) {
      const safe_command = await this.secret_vault.mask_known_secrets(command);
      const compact_command = redact_sensitive_text(safe_command).text;
      if (guard.kind === "approval_required") {
        return [
          "Error: approval_required",
          `reason: ${guard.reason}`,
          `requested_path: ${guard.requested_path || "(unknown)"}`,
          "action: Ask leader/user for approval before re-running this command.",
          `command: ${compact_command}`,
        ].join("\n");
      }
      return `Error: ${guard.reason}`;
    }

    if (context?.signal?.aborted) return "Error: cancelled";
    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd,
        timeout_ms: timeout_seconds * 1000,
        max_buffer_bytes: 1024 * 1024 * 8,
        signal: context?.signal,
        force_native_shell: approved_outside_workspace,
      });
      const output_raw = [stdout || "", stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n");
      const output_masked = await this.secret_vault.mask_known_secrets(output_raw);
      const output = redact_sensitive_text(output_masked).text;
      const text = output.trim() || "(no output)";
      return text.length > 20000 ? `${text.slice(0, 20000)}\n... (truncated)` : text;
    } catch (error) {
      // exec 실패 시 stdout에 유효한 결과가 있을 수 있음 (PowerShell non-zero exit + JSON 출력)
      const exec_err = error as { stdout?: string; stderr?: string; code?: number };
      if (exec_err.stdout) {
        const out = String(exec_err.stdout).trim();
        if (out) {
          const masked = redact_sensitive_text(await this.secret_vault.mask_known_secrets(out)).text;
          return masked.length > 20000 ? `${masked.slice(0, 20000)}\n... (truncated)` : masked;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      const safe = redact_sensitive_text(await this.secret_vault.mask_known_secrets(message)).text;
      return `Error: ${safe}`;
    }
  }

  private _guard_command(command: string, cwd: string): { kind: "blocked" | "approval_required"; reason: string; requested_path?: string } | null {
    const lower = command.toLowerCase();
    if (this.has_shell_obfuscation(command)) {
      return { kind: "blocked", reason: "blocked by safety anti-obfuscation policy" };
    }
    for (const pattern of this.deny_patterns) {
      if (pattern.test(lower)) return { kind: "blocked", reason: "blocked by safety deny-pattern" };
    }
    for (const pattern of this.write_approval_patterns) {
      if (pattern.test(lower)) {
        return {
          kind: "approval_required",
          reason: "write-related command requires approval",
        };
      }
    }
    if (this.allow_patterns.length > 0 && !this.allow_patterns.some((p) => p.test(lower))) {
      return { kind: "blocked", reason: "blocked by safety allowlist" };
    }
    if (this.restrict_to_working_dir) {
      if (lower.includes("../") || lower.includes("..\\")) return { kind: "blocked", reason: "path traversal is not allowed" };
      const win_paths = command.match(/[A-Za-z]:\\[^\s"'`]+/g) || [];
      const unix_abs_paths = command.match(/(?:^|[\s"'`])\/[A-Za-z0-9._\-/]+/g) || [];
      for (const raw of win_paths) {
        const abs = resolve(raw);
        const cwd_norm = cwd.toLowerCase();
        const abs_norm = abs.toLowerCase();
        if (abs_norm !== cwd_norm && !abs_norm.startsWith(`${cwd_norm}\\`) && !abs_norm.startsWith(`${cwd_norm}/`)) {
          return {
            kind: "approval_required",
            reason: "absolute path outside workspace",
            requested_path: abs,
          };
        }
      }
      for (const raw of unix_abs_paths) {
        const candidate = raw.trim().replace(/^["'`\s]+/, "");
        if (!candidate.startsWith("/")) continue;
        const abs = resolve(candidate);
        const cwd_norm = cwd.toLowerCase();
        const abs_norm = abs.toLowerCase();
        if (abs_norm !== cwd_norm && !abs_norm.startsWith(`${cwd_norm}\\`) && !abs_norm.startsWith(`${cwd_norm}/`)) {
          return {
            kind: "approval_required",
            reason: "absolute path outside workspace",
            requested_path: abs,
          };
        }
      }
    }
    return null;
  }

  private has_shell_obfuscation(command: string): boolean {
    const text = String(command || "");
    if (!text) return false;
    if (/`[^`]+`/.test(text)) return true;
    if (/\$\([^)]*\)/.test(text)) return true;
    if (/\balias\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(text)) return true;
    if (/\bfunction\s+[a-zA-Z_][a-zA-Z0-9_]*\b/.test(text)) return true;
    return false;
  }
}
