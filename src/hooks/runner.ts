/** HookRunner — 훅 정의를 받아 이벤트 발생 시 실행하는 엔진. */

import { spawn } from "node:child_process";
import { error_message } from "../utils/common.js";
import type {
  HookDefinition,
  HookEventName,
  HookExecutionResult,
  HookInput,
  HookOutput,
  HooksConfig,
} from "./types.js";

/** 환경변수 치환: $VAR 또는 ${VAR} → process.env[VAR]. */
function interpolate_env(text: string): string {
  return text.replace(/\$\{([^}]+)\}|\$([A-Za-z_]\w*)/g, (_match, braced, bare) => {
    const key = braced || bare;
    return process.env[key] || "";
  });
}

/** 커맨드 훅 실행. stdin으로 JSON을 전달하고 stdout JSON 파싱. */
async function run_command_hook(
  command: string,
  input: HookInput,
  cwd: string,
  timeout_ms: number,
): Promise<HookOutput> {
  const resolved_cmd = interpolate_env(command);
  return new Promise<HookOutput>((resolve) => {
    const child = spawn(resolved_cmd, [], {
      shell: true,
      cwd,
      timeout: timeout_ms,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOOK_EVENT: input.hook_event_name },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();

    child.on("error", (err) => {
      resolve({ decision: "ignore", reason: `spawn_error: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code === 2) {
        // exit code 2 = 차단
        const parsed = parse_hook_json(stdout);
        resolve({
          decision: "deny",
          reason: parsed?.reason || stderr.trim() || `hook exited with code 2`,
          additional_context: parsed?.additional_context,
        });
        return;
      }
      if (code !== 0) {
        resolve({ decision: "ignore", reason: `hook exited with code ${code}: ${stderr.trim().slice(0, 200)}` });
        return;
      }
      const parsed = parse_hook_json(stdout);
      resolve(parsed || { decision: "allow" });
    });
  });
}

/** HTTP 훅 실행. POST로 HookInput을 전송. */
async function run_http_hook(
  url: string,
  input: HookInput,
  headers: Record<string, string>,
  timeout_ms: number,
): Promise<HookOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { decision: "ignore", reason: `http_${response.status}` };
    }
    const text = await response.text();
    return parse_hook_json(text) || { decision: "allow" };
  } catch (err) {
    clearTimeout(timer);
    const msg = error_message(err);
    return { decision: "ignore", reason: `http_error: ${msg}` };
  }
}

/** stdout/body JSON 파싱. 실패 시 null. */
function parse_hook_json(text: string): HookOutput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      decision: (obj.decision as HookOutput["decision"]) || undefined,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      updated_input: obj.updated_input && typeof obj.updated_input === "object"
        ? obj.updated_input as Record<string, unknown>
        : undefined,
      additional_context: typeof obj.additional_context === "string" ? obj.additional_context : undefined,
    };
  } catch {
    return null;
  }
}

export class HookRunner {
  private readonly hooks: Map<HookEventName, HookDefinition[]> = new Map();
  private readonly workspace: string;

  constructor(workspace: string, config?: HooksConfig | null) {
    this.workspace = workspace;
    if (config?.hooks) {
      for (const [event, defs] of Object.entries(config.hooks)) {
        const active = (defs as HookDefinition[]).filter((d) => !d.disabled);
        if (active.length > 0) {
          this.hooks.set(event as HookEventName, active);
        }
      }
    }
  }

  /** 등록된 훅 정의를 추가. */
  add(definition: HookDefinition): void {
    if (definition.disabled) return;
    const list = this.hooks.get(definition.event) || [];
    list.push(definition);
    this.hooks.set(definition.event, list);
  }

  /** 특정 이벤트에 등록된 훅이 있는지. */
  has(event: HookEventName): boolean {
    return (this.hooks.get(event)?.length ?? 0) > 0;
  }

  /** 등록된 모든 훅 이름 목록. */
  list_hooks(): { event: HookEventName; name: string; handler_type: string }[] {
    const result: { event: HookEventName; name: string; handler_type: string }[] = [];
    for (const [event, defs] of this.hooks) {
      for (const d of defs) {
        result.push({ event, name: d.name, handler_type: d.handler.type });
      }
    }
    return result;
  }

  /**
   * 이벤트에 등록된 훅들을 실행.
   * 동기 훅은 순차 실행하고 첫 deny에서 중단.
   * 비동기 훅은 fire-and-forget.
   */
  async fire(event: HookEventName, input: HookInput): Promise<HookExecutionResult[]> {
    const defs = this.hooks.get(event);
    if (!defs || defs.length === 0) return [];

    const results: HookExecutionResult[] = [];
    for (const def of defs) {
      // matcher 필터링 (도구 이벤트 전용)
      if (def.matcher && input.tool_name) {
        try {
          if (!new RegExp(def.matcher).test(input.tool_name)) continue;
        } catch {
          continue; // 잘못된 정규식 무시
        }
      }

      if (def.async) {
        this._run_single(def, input).catch(() => {});
        results.push({ hook_name: def.name, output: { decision: "ignore" }, duration_ms: 0 });
        continue;
      }

      const result = await this._run_single(def, input);
      results.push(result);

      // deny면 후속 훅 중단
      if (result.output.decision === "deny") break;
    }
    return results;
  }

  private async _run_single(def: HookDefinition, input: HookInput): Promise<HookExecutionResult> {
    const start = Date.now();
    try {
      let output: HookOutput;
      if (def.handler.type === "command") {
        const cwd = def.handler.cwd || this.workspace;
        const timeout = def.handler.timeout_ms ?? 10_000;
        output = await run_command_hook(def.handler.command, input, cwd, timeout);
      } else {
        const timeout = def.handler.timeout_ms ?? 5_000;
        output = await run_http_hook(
          def.handler.url,
          input,
          def.handler.headers || {},
          timeout,
        );
      }
      return { hook_name: def.name, output, duration_ms: Date.now() - start };
    } catch (err) {
      const msg = error_message(err);
      return {
        hook_name: def.name,
        output: { decision: "ignore", reason: msg },
        duration_ms: Date.now() - start,
        error: msg,
      };
    }
  }
}
