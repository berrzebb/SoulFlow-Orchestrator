/**
 * CLI별 NDJSON 출력을 AgentOutputMessage로 매핑하는 어댑터.
 *
 * 각 CLI의 공식 레퍼런스에 기반:
 *   Claude Code: https://code.claude.com/docs/en/cli-reference
 *   Codex CLI:   https://developers.openai.com/codex/cli/reference/
 *   Gemini CLI:  https://geminicli.com/docs/cli/cli-reference/
 */

import type { CliAdapter, StdinMode, BuildArgsOptions, AgentInputMessage, AgentOutputMessage, ErrorCode } from "./types.js";
import { classify_provider_error, type ProviderErrorCode } from "../../quality/provider-error-taxonomy.js";

/**
 * Claude Code (-p --output-format stream-json) 어댑터.
 *
 * stdin_mode = "close": -p 모드는 stdin EOF 이후 처리 시작.
 * 프롬프트는 원시 텍스트로 stdin에 전달 (NDJSON 아님).
 *
 * 출력 형식:
 *   {"type":"system","subtype":"init","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"result","result":"...","session_id":"..."}
 */
export class ClaudeCliAdapter implements CliAdapter {
  readonly cli_id = "claude";
  readonly stdin_mode: StdinMode = "close";
  readonly supports_system_prompt_flag = true;
  readonly supports_tool_filtering = true;
  readonly supports_structured_output = true;
  readonly supports_budget_tracking = true;
  readonly supports_approval = false;
  readonly supports_thinking = false;
  session_id: string | null = null;

  build_args(options: BuildArgsOptions): string[] {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
    ];
    // root 권한에서는 --dangerously-skip-permissions 사용 불가 (Claude Code 보안 제한)
    if (process.getuid?.() !== 0) {
      args.push("--dangerously-skip-permissions");
    }
    if (options.session_key && is_uuid(options.session_key)) args.push("--session-id", options.session_key);
    if (options.system_prompt) args.push("--append-system-prompt", options.system_prompt);
    if (options.model) args.push("--model", options.model);
    if (options.max_turns !== null && options.max_turns !== undefined) args.push("--max-turns", String(options.max_turns));
    if (options.allowed_tools?.length) args.push("--allowedTools", ...options.allowed_tools);
    if (options.disallowed_tools?.length) args.push("--disallowedTools", ...options.disallowed_tools);
    if (options.add_dirs?.length) args.push("--add-dir", ...options.add_dirs);
    if (options.ephemeral) args.push("--no-session-persistence");
    if (options.max_budget_usd !== null && options.max_budget_usd !== undefined) args.push("--max-budget-usd", String(options.max_budget_usd));
    if (options.json_schema) args.push("--json-schema", options.json_schema);
    if (options.mcp_config) args.push("--mcp-config", options.mcp_config);
    return args;
  }

  parse_output(line: string): AgentOutputMessage | AgentOutputMessage[] | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return null;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(trimmed); }
    catch { return null; }

    const type = String(parsed.type ?? "");

    if (type === "system" && parsed.subtype === "init") {
      this.session_id = String(parsed.session_id ?? "");
      return null;
    }

    if (type === "assistant") {
      const msg = parsed.message as Record<string, unknown> | undefined;
      const content_blocks = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!content_blocks?.length) return null;

      // content block 별 메시지 생성: text, tool_use, tool_result 각각 매핑
      const messages: AgentOutputMessage[] = [];
      for (const block of content_blocks) {
        if (block.type === "text") {
          const text = String(block.text ?? "");
          if (text) messages.push({ type: "assistant_chunk", content: text, delta: true });
        } else if (block.type === "tool_use") {
          messages.push({
            type: "tool_use",
            tool: String(block.name ?? "unknown"),
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        } else if (block.type === "tool_result") {
          messages.push({
            type: "tool_result",
            tool: String(block.tool_use_id ?? "unknown"),
            output: extract_tool_result_text(block),
          });
        }
      }

      if (messages.length === 0) return null;
      if (messages.length === 1) return messages[0];
      return messages;
    }

    if (type === "result") {
      const usage = parsed.usage as Record<string, number> | undefined;
      return {
        type: "complete",
        result: String(parsed.result ?? ""),
        usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return {
        type: "error",
        code: map_error_code(parsed),
        message: String(parsed.error ?? parsed.message ?? "unknown_error"),
      };
    }

    return null;
  }

  /** 원시 텍스트. Claude -p 모드는 stdin을 프롬프트로 읽는다. */
  format_input(msg: AgentInputMessage): string {
    return msg.content + "\n";
  }
}

/**
 * Codex CLI (exec --json) 어댑터.
 *
 * stdin_mode = "close": exec 모드는 stdin(-) EOF 이후 처리 시작.
 *
 * JSONL 이벤트 프로토콜 (codex exec --json):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"item.started","item":{"type":"command_execution","command":"..."}}
 *   {"type":"item.completed","item":{"type":"command_execution","command":"...","aggregated_output":"...","exit_code":0}}
 *   {"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
 */
export class CodexCliAdapter implements CliAdapter {
  readonly cli_id = "codex";
  readonly stdin_mode: StdinMode = "close";
  readonly supports_system_prompt_flag = true;
  /** 프롬프트 기반 도구 필터링. developer_instructions로 화이트/블랙리스트 주입. */
  readonly supports_tool_filtering = true;
  readonly supports_structured_output = true;
  readonly supports_budget_tracking = false;
  readonly supports_approval = false;
  readonly supports_thinking = false;
  session_id: string | null = null;

  /** 턴 내 마지막 agent_message를 누적. turn.completed에서 complete로 반환. */
  private last_text = "";

  build_args(options: BuildArgsOptions): string[] {
    // global flags → exec 서브커맨드 앞에 배치 (레퍼런스 준수)
    const args = [
      "--dangerously-bypass-approvals-and-sandbox",   // global: 컨테이너가 보안 경계
    ];
    if (options.model) args.push("--model", options.model);   // global: 모델 오버라이드
    // system_prompt + tool_definitions + 도구 필터링 → developer_instructions로 주입 (--config global flag)
    const dev_instructions = build_developer_instructions(options);
    if (dev_instructions) {
      args.push("--config", `developer_instructions=${dev_instructions}`);
    }
    if (options.add_dirs?.length) args.push("--add-dir", ...options.add_dirs);
    // exec 서브커맨드 + exec-specific flags
    args.push("exec", "--json");
    if (options.ephemeral) args.push("--ephemeral");
    // resume: session_key가 UUID면 기존 세션 이어받기 (codex exec resume SESSION_ID)
    if (options.session_key && is_uuid(options.session_key)) {
      args.push("resume", options.session_key);
    }
    args.push("-");   // stdin에서 프롬프트 읽기
    return args;
  }

  parse_output(line: string): AgentOutputMessage | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(trimmed); }
    catch { return null; }

    const type = String(parsed.type ?? "");

    if (type === "thread.started") {
      this.session_id = String(parsed.thread_id ?? "");
      this.last_text = "";
      return null;
    }

    if (type === "turn.started") return null;

    if (type === "item.completed" || type === "item.started") {
      return this.parse_item(parsed.item as Record<string, unknown> | undefined, type);
    }

    if (type === "turn.completed") {
      const usage = parsed.usage as Record<string, number> | undefined;
      return {
        type: "complete",
        result: this.last_text,
        usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return {
        type: "error",
        code: map_error_code(parsed),
        message: String(parsed.message ?? parsed.error ?? "unknown_error"),
      };
    }

    return null;
  }

  /** 원시 텍스트. exec 모드는 stdin을 프롬프트로 읽는다 (-). */
  format_input(msg: AgentInputMessage): string {
    return msg.content + "\n";
  }

  private parse_item(item: Record<string, unknown> | undefined, event: string): AgentOutputMessage | null {
    if (!item) return null;
    const item_type = String(item.type ?? "");

    if (item_type === "agent_message" && event === "item.completed") {
      const text = String(item.text ?? "");
      if (text) this.last_text = text;
      return { type: "assistant_chunk", content: text, delta: true };
    }

    if (item_type === "command_execution") {
      if (event === "item.started") {
        return {
          type: "tool_use",
          tool: "shell",
          input: { command: String(item.command ?? "") },
        };
      }
      if (event === "item.completed") {
        return {
          type: "tool_result",
          tool: "shell",
          output: String(item.aggregated_output ?? ""),
        };
      }
    }

    // apply_patch, update_plan 등 기타 도구 이벤트 (프롬프팅 가이드 참조)
    if (item_type && item_type !== "agent_message") {
      if (event === "item.started") {
        return {
          type: "tool_use",
          tool: item_type,
          input: extract_tool_input(item),
        };
      }
      if (event === "item.completed") {
        return {
          type: "tool_result",
          tool: item_type,
          output: String(item.output ?? item.aggregated_output ?? ""),
        };
      }
    }

    return null;
  }
}

/** tool_result content block에서 텍스트를 추출. content가 문자열 또는 배열 형태. */
function extract_tool_result_text(block: Record<string, unknown>): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && (c as Record<string, unknown>).type === "text") {
          return String((c as Record<string, unknown>).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

/** ProviderErrorCode → PTY 내부 ErrorCode 변환 (경계 브리지). */
function to_pty_code(code: ProviderErrorCode): ErrorCode {
  const MAP: Record<ProviderErrorCode, ErrorCode> = {
    auth_invalid: "auth",
    billing_exceeded: "billing",
    rate_limited: "rate_limit",
    context_overflow: "token_limit",
    model_unavailable: "failover",
    provider_crash: "crash",
    network_error: "timeout",
    unknown: "fatal",
  };
  return MAP[code];
}

/** 파싱된 JSON → PTY ErrorCode. 세 어댑터의 중복 분류 로직을 통합. */
function map_error_code(parsed: Record<string, unknown>): ErrorCode {
  const msg = String(parsed.error ?? parsed.message ?? "");
  return to_pty_code(classify_provider_error(msg));
}

/** 도구 아이템에서 입력 파라미터를 추출. arguments(JSON) 또는 개별 필드. */
function extract_tool_input(item: Record<string, unknown>): Record<string, unknown> {
  // Responses API 형식: arguments가 JSON 문자열
  if (typeof item.arguments === "string") {
    try { return JSON.parse(item.arguments); }
    catch { return { arguments: item.arguments }; }
  }
  // 개별 필드에서 추출 (type, call_id 등 메타 필드 제외)
  const { type: _, call_id: _2, id: _3, status: _4, ...rest } = item;
  return rest;
}

/**
 * Gemini CLI (--output-format stream-json) 어댑터.
 *
 * stdin_mode = "close": 파이프 모드는 stdin EOF 이후 처리 시작.
 * 시스템 프롬프트: GEMINI_SYSTEM_MD 환경변수로 파일 경로 전달.
 *
 * stream-json 이벤트 프로토콜:
 *   {"type":"init","session_id":"...","model":"..."}
 *   {"type":"message","role":"assistant","content":"...","delta":true}
 *   {"type":"tool_use","tool_name":"Bash","tool_id":"...","parameters":{}}
 *   {"type":"tool_result","tool_id":"...","status":"success","output":"..."}
 *   {"type":"result",...}
 *   {"type":"error",...}
 */
export class GeminiCliAdapter implements CliAdapter {
  readonly cli_id = "gemini";
  readonly stdin_mode: StdinMode = "close";
  /** 시스템 프롬프트는 GEMINI_SYSTEM_MD 환경변수 + 파일로 전달. CLI 플래그 없음. */
  readonly supports_system_prompt_flag = false;
  /** --allowed-tools 지원 (deprecated이지만 동작함). */
  readonly supports_tool_filtering = true;
  readonly supports_structured_output = false;
  readonly supports_budget_tracking = false;
  readonly supports_approval = false;
  readonly supports_thinking = false;
  session_id: string | null = null;

  /** 마지막 assistant message를 누적. result 이벤트에 응답 텍스트가 없으므로 직접 추적. */
  private last_text = "";

  build_args(options: BuildArgsOptions): string[] {
    const args = [
      "-p", "",                      // headless 모드, stdin에서 프롬프트 읽기
      "--output-format", "stream-json",
      "--approval-mode", "yolo",     // 컨테이너가 보안 경계
    ];
    if (options.model) args.push("--model", options.model);
    if (options.session_key && is_uuid(options.session_key)) args.push("--resume", options.session_key);
    if (options.allowed_tools?.length) args.push("--allowed-tools", options.allowed_tools.join(","));
    if (options.add_dirs?.length) args.push("--include-directories", ...options.add_dirs);
    if (options.mcp_config) args.push("--extensions", options.mcp_config);
    return args;
  }

  parse_output(line: string): AgentOutputMessage | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(trimmed); }
    catch { return null; }

    const type = String(parsed.type ?? "");

    if (type === "init") {
      this.session_id = String(parsed.session_id ?? "");
      this.last_text = "";
      return null;
    }

    if (type === "message") {
      const role = String(parsed.role ?? "");
      if (role !== "assistant") return null;
      const content = String(parsed.content ?? "");
      if (!content) return null;
      this.last_text += content;
      return { type: "assistant_chunk", content, delta: true };
    }

    if (type === "tool_use") {
      return {
        type: "tool_use",
        tool: String(parsed.tool_name ?? "unknown"),
        input: (parsed.parameters ?? {}) as Record<string, unknown>,
      };
    }

    if (type === "tool_result") {
      return {
        type: "tool_result",
        tool: String(parsed.tool_name ?? "unknown"),
        output: String(parsed.output ?? ""),
      };
    }

    if (type === "result") {
      const stats = parsed.stats as Record<string, number> | undefined;
      return {
        type: "complete",
        result: this.last_text || String(parsed.response ?? ""),
        usage: stats ? { input: stats.input_tokens ?? 0, output: stats.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return {
        type: "error",
        code: map_error_code(parsed),
        message: String(parsed.message ?? parsed.error ?? "unknown_error"),
      };
    }

    return null;
  }

  /** 원시 텍스트. 파이프 모드는 stdin을 프롬프트로 읽는다. */
  format_input(msg: AgentInputMessage): string {
    return msg.content + "\n";
  }
}


/** system_prompt, tool_definitions, 도구 필터링을 결합하여 developer_instructions 문자열 생성. */
function build_developer_instructions(options: BuildArgsOptions): string {
  const parts: string[] = [];
  if (options.system_prompt) parts.push(options.system_prompt);
  if (options.tool_definitions) parts.push(`## Tools\n\n${options.tool_definitions}`);
  if (options.allowed_tools?.length) {
    parts.push(`## Allowed Tools\n\nYou may ONLY use the following tools: ${options.allowed_tools.join(", ")}`);
  }
  if (options.disallowed_tools?.length) {
    parts.push(`## Disallowed Tools\n\nYou must NEVER use the following tools: ${options.disallowed_tools.join(", ")}`);
  }
  return parts.join("\n\n");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function is_uuid(s: string): boolean { return UUID_RE.test(s); }
