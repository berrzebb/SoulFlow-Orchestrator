/**
 * Mock NDJSON agent용 CliAdapter.
 *
 * mock-ndjson-agent.ts와 쌍으로 동작:
 *   - stdin: NDJSON 입력 (keep mode)
 *   - stdout: Claude stream-json 호환 NDJSON 출력
 */

import type { CliAdapter, StdinMode, BuildArgsOptions, AgentInputMessage, AgentOutputMessage } from "@src/agent/pty/types.ts";

export class MockCliAdapter implements CliAdapter {
  readonly cli_id = "mock";
  readonly stdin_mode: StdinMode = "keep";
  readonly supports_system_prompt_flag = false;
  readonly supports_tool_filtering = false;
  session_id: string | null = null;

  build_args(options: BuildArgsOptions): string[] {
    const args: string[] = [];
    if (options.session_key) args.push("--session-id", options.session_key);
    return args;
  }

  parse_output(line: string): AgentOutputMessage | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

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
      const text = content_blocks
        .filter(b => b.type === "text")
        .map(b => String(b.text ?? ""))
        .join("");
      if (!text) return null;
      return { type: "assistant_chunk", content: text, delta: true };
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
        code: "fatal",
        message: String(parsed.error ?? parsed.message ?? "unknown_error"),
      };
    }

    return null;
  }

  format_input(msg: AgentInputMessage): string {
    return JSON.stringify(msg) + "\n";
  }
}
