import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import type { AgentOutputMessage } from "@src/agent/pty/types.ts";

describe("ClaudeCliAdapter", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("init 이벤트에서 session_id를 캡처한다", () => {
    const msg = adapter.parse_output('{"type":"system","subtype":"init","session_id":"sess-123"}');
    expect(msg).toBeNull();
    expect(adapter.session_id).toBe("sess-123");
  });

  it("assistant 메시지를 assistant_chunk로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello world"}]}}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("assistant_chunk");
    if (msg!.type === "assistant_chunk") {
      expect(msg!.content).toBe("hello world");
      expect(msg!.delta).toBe(true);
    }
  });

  it("여러 text 블록을 연결한다", () => {
    const msg = adapter.parse_output(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}',
    );
    if (msg?.type === "assistant_chunk") expect(msg.content).toBe("ab");
  });

  it("result를 complete로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"result","result":"done","usage":{"input_tokens":100,"output_tokens":50}}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("complete");
    if (msg!.type === "complete") {
      expect(msg!.result).toBe("done");
      expect(msg!.usage).toEqual({ input: 100, output: 50 });
    }
  });

  it("error를 error 메시지로 변환한다", () => {
    const msg = adapter.parse_output('{"type":"error","error":"invalid api key"}');
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("error");
    if (msg!.type === "error") {
      expect(msg!.code).toBe("auth");
      expect(msg!.message).toBe("invalid api key");
    }
  });

  it("빈 assistant content를 무시한다", () => {
    expect(adapter.parse_output('{"type":"assistant","message":{"content":[]}}')).toBeNull();
  });

  it("잘못된 JSON을 무시한다", () => {
    expect(adapter.parse_output("not json")).toBeNull();
  });

  it("UUID session_key를 --session-id로 포함한다", () => {
    const args = adapter.build_args({ session_key: "550e8400-e29b-41d4-a716-446655440000" });
    expect(args).toContain("--session-id");
    expect(args).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  it("비-UUID session_key는 --session-id를 생략한다", () => {
    const args = adapter.build_args({ session_key: "my-custom-key" });
    expect(args).not.toContain("--session-id");
    expect(args).toContain("-p");
  });

  it("system_prompt를 --append-system-prompt로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", system_prompt: "be helpful" });
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("be helpful");
  });

  it("model을 --model로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", model: "claude-sonnet-4-20250514" });
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-20250514");
  });

  it("max_turns를 --max-turns로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", max_turns: 5 });
    expect(args).toContain("--max-turns");
    expect(args).toContain("5");
  });

  it("allowed_tools를 --allowedTools로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", allowed_tools: ["Read", "Write"] });
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read");
    expect(args).toContain("Write");
  });

  it("disallowed_tools를 --disallowedTools로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", disallowed_tools: ["Bash"] });
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash");
  });

  it("add_dirs를 --add-dir로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", add_dirs: ["/src", "/lib"] });
    expect(args).toContain("--add-dir");
    expect(args).toContain("/src");
    expect(args).toContain("/lib");
  });

  it("ephemeral을 --no-session-persistence로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", ephemeral: true });
    expect(args).toContain("--no-session-persistence");
  });

  it("max_budget_usd를 --max-budget-usd로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", max_budget_usd: 5.0 });
    expect(args).toContain("--max-budget-usd");
    expect(args).toContain("5");
  });

  it("json_schema를 --json-schema로 전달한다", () => {
    const schema = '{"type":"object","properties":{"name":{"type":"string"}}}';
    const args = adapter.build_args({ session_key: "test", json_schema: schema });
    expect(args).toContain("--json-schema");
    expect(args).toContain(schema);
  });

  it("mcp_config를 --mcp-config로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", mcp_config: "./mcp.json" });
    expect(args).toContain("--mcp-config");
    expect(args).toContain("./mcp.json");
  });

  it("supports_system_prompt_flag가 true이다", () => {
    expect(adapter.supports_system_prompt_flag).toBe(true);
  });

  it("supports_tool_filtering이 true이다", () => {
    expect(adapter.supports_tool_filtering).toBe(true);
  });

  it("format_input은 원시 텍스트 + 개행으로 포맷한다", () => {
    const out = adapter.format_input({ type: "user_message", content: "hi" });
    expect(out).toBe("hi\n");
  });

  it("stdin_mode가 close이다", () => {
    expect(adapter.stdin_mode).toBe("close");
  });

  it("tool_use content block을 tool_use로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/foo"}}]}}',
    );
    expect(msg).not.toBeNull();
    const single = Array.isArray(msg) ? msg[0] : msg!;
    expect(single.type).toBe("tool_use");
    if (single.type === "tool_use") {
      expect(single.tool).toBe("Read");
      expect(single.input).toEqual({ file_path: "/foo" });
    }
  });

  it("tool_result content block을 tool_result로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"assistant","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"file contents"}]}}',
    );
    expect(msg).not.toBeNull();
    const single = Array.isArray(msg) ? msg[0] : msg!;
    expect(single.type).toBe("tool_result");
    if (single.type === "tool_result") {
      expect(single.output).toBe("file contents");
    }
  });

  it("혼합 content block(text + tool_use)을 복수 메시지로 반환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"reading..."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
    );
    expect(Array.isArray(msg)).toBe(true);
    const arr = msg as import("@src/agent/pty/types.ts").AgentOutputMessage[];
    expect(arr).toHaveLength(2);
    expect(arr[0].type).toBe("assistant_chunk");
    expect(arr[1].type).toBe("tool_use");
  });
});

describe("CodexCliAdapter", () => {
  let adapter: CodexCliAdapter;

  // 매 테스트마다 상태(last_text) 초기화
  beforeEach(() => { adapter = new CodexCliAdapter(); });

  it("thread.started에서 session_id를 캡처한다", () => {
    const msg = adapter.parse_output('{"type":"thread.started","thread_id":"abc-123"}');
    expect(msg).toBeNull();
    expect(adapter.session_id).toBe("abc-123");
  });

  it("item.completed agent_message를 assistant_chunk로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"item.completed","item":{"type":"agent_message","text":"hey"}}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("assistant_chunk");
    if (msg!.type === "assistant_chunk") expect(msg!.content).toBe("hey");
  });

  it("item.started command_execution을 tool_use로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"item.started","item":{"type":"command_execution","command":"/bin/bash -lc \'ls\'"}}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("tool_use");
    if (msg!.type === "tool_use") {
      expect(msg!.tool).toBe("shell");
      expect(msg!.input).toEqual({ command: "/bin/bash -lc 'ls'" });
    }
  });

  it("item.completed command_execution을 tool_result로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"file.txt\\n","exit_code":0}}',
    );
    expect(msg!.type).toBe("tool_result");
    if (msg!.type === "tool_result") expect(msg!.output).toBe("file.txt\n");
  });

  it("turn.completed를 complete로 변환한다 (마지막 agent_message 포함)", () => {
    adapter.parse_output('{"type":"item.completed","item":{"type":"agent_message","text":"all done"}}');
    const msg = adapter.parse_output('{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}');
    expect(msg!.type).toBe("complete");
    if (msg!.type === "complete") {
      expect(msg!.result).toBe("all done");
      expect(msg!.usage).toEqual({ input: 100, output: 50 });
    }
  });

  it("error를 에러 메시지로 변환한다", () => {
    const msg = adapter.parse_output('{"type":"error","message":"something broke"}');
    expect(msg!.type).toBe("error");
    if (msg!.type === "error") expect(msg!.message).toBe("something broke");
  });

  it("build_args에 exec --json을 포함하고 global flag는 exec 앞에 위치한다", () => {
    const args = adapter.build_args({ session_key: "any-key" });
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("-");
    // global flag는 exec 서브커맨드 앞에 위치해야 함 (레퍼런스 준수)
    const execIdx = args.indexOf("exec");
    const bypassIdx = args.indexOf("--dangerously-bypass-approvals-and-sandbox");
    expect(bypassIdx).toBeLessThan(execIdx);
  });

  it("UUID session_key를 exec resume SESSION_ID로 전달한다", () => {
    const args = adapter.build_args({ session_key: "550e8400-e29b-41d4-a716-446655440000" });
    const execIdx = args.indexOf("exec");
    expect(args[execIdx + 2]).toBe("resume");
    expect(args[execIdx + 3]).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("비-UUID session_key는 resume을 생략한다", () => {
    const args = adapter.build_args({ session_key: "my-key" });
    expect(args).not.toContain("resume");
  });

  it("model을 --model로 전달한다 (exec 앞 global flag)", () => {
    const args = adapter.build_args({ session_key: "test", model: "gpt-4o" });
    expect(args).toContain("--model");
    expect(args).toContain("gpt-4o");
    // --model은 global flag → exec 앞
    const execIdx = args.indexOf("exec");
    const modelIdx = args.indexOf("--model");
    expect(modelIdx).toBeLessThan(execIdx);
  });

  it("item.started apply_patch를 tool_use로 변환한다", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "apply_patch", arguments: JSON.stringify({ patch: "--- a/file.ts\n+++ b/file.ts" }) },
    });
    const msg = adapter.parse_output(line);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("tool_use");
    if (msg!.type === "tool_use") {
      expect(msg!.tool).toBe("apply_patch");
      expect((msg!.input as Record<string, unknown>).patch).toContain("file.ts");
    }
  });

  it("item.completed apply_patch를 tool_result로 변환한다", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "apply_patch", output: "patch applied successfully" },
    });
    const msg = adapter.parse_output(line);
    expect(msg!.type).toBe("tool_result");
    if (msg!.type === "tool_result") {
      expect(msg!.tool).toBe("apply_patch");
      expect(msg!.output).toBe("patch applied successfully");
    }
  });

  it("update_plan 도구도 tool_use로 전달한다", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "update_plan", arguments: JSON.stringify({ plan: [{ step: "test", status: "pending" }] }) },
    });
    const msg = adapter.parse_output(line);
    expect(msg!.type).toBe("tool_use");
    if (msg!.type === "tool_use") {
      expect(msg!.tool).toBe("update_plan");
      expect((msg!.input as Record<string, unknown>).plan).toBeDefined();
    }
  });

  it("supports_system_prompt_flag가 true이다", () => {
    expect(adapter.supports_system_prompt_flag).toBe(true);
  });

  it("system_prompt를 --config developer_instructions로 전달한다 (exec 앞 global flag)", () => {
    const args = adapter.build_args({ session_key: "test", system_prompt: "be concise" });
    expect(args).toContain("--config");
    const configIdx = args.indexOf("--config");
    expect(args[configIdx + 1]).toBe("developer_instructions=be concise");
    // global flag → exec 앞
    const execIdx = args.indexOf("exec");
    expect(configIdx).toBeLessThan(execIdx);
  });

  it("system_prompt + tool_definitions를 결합하여 developer_instructions로 전달한다", () => {
    const args = adapter.build_args({
      session_key: "test",
      system_prompt: "be concise",
      tool_definitions: "### custom_tool\nDoes something.",
    });
    const configIdx = args.indexOf("--config");
    const value = args[configIdx + 1];
    expect(value).toContain("be concise");
    expect(value).toContain("## Tools");
    expect(value).toContain("### custom_tool");
  });

  it("system_prompt 없이 tool_definitions만 전달할 수 있다", () => {
    const args = adapter.build_args({
      session_key: "test",
      tool_definitions: "### my_tool\nDescription.",
    });
    expect(args).toContain("--config");
    const configIdx = args.indexOf("--config");
    const value = args[configIdx + 1];
    expect(value).toContain("## Tools");
    expect(value).toContain("### my_tool");
    expect(value).not.toContain("undefined");
  });

  it("system_prompt와 tool_definitions 모두 없으면 --config를 생략한다", () => {
    const args = adapter.build_args({ session_key: "test" });
    expect(args).not.toContain("--config");
  });

  it("supports_tool_filtering이 true이다 (프롬프트 기반)", () => {
    expect(adapter.supports_tool_filtering).toBe(true);
  });

  it("allowed_tools를 developer_instructions에 포함한다", () => {
    const args = adapter.build_args({ session_key: "test", allowed_tools: ["shell", "apply_patch"] });
    const configIdx = args.indexOf("--config");
    expect(configIdx).toBeGreaterThanOrEqual(0);
    const value = args[configIdx + 1];
    expect(value).toContain("Allowed Tools");
    expect(value).toContain("shell, apply_patch");
  });

  it("disallowed_tools를 developer_instructions에 포함한다", () => {
    const args = adapter.build_args({ session_key: "test", disallowed_tools: ["dangerous_tool"] });
    const configIdx = args.indexOf("--config");
    const value = args[configIdx + 1];
    expect(value).toContain("Disallowed Tools");
    expect(value).toContain("dangerous_tool");
  });

  it("system_prompt + allowed_tools를 결합한다", () => {
    const args = adapter.build_args({
      session_key: "test",
      system_prompt: "be safe",
      allowed_tools: ["shell"],
    });
    const configIdx = args.indexOf("--config");
    const value = args[configIdx + 1];
    expect(value).toContain("be safe");
    expect(value).toContain("Allowed Tools");
    expect(value).toContain("shell");
  });

  it("도구 필터링만 있으면 --config에 포함된다 (system_prompt 없이)", () => {
    const args = adapter.build_args({ session_key: "test", allowed_tools: ["shell"] });
    expect(args).toContain("--config");
    const configIdx = args.indexOf("--config");
    const value = args[configIdx + 1];
    expect(value).not.toContain("undefined");
    expect(value).toContain("shell");
  });

  it("add_dirs를 --add-dir로 전달한다 (global flag)", () => {
    const args = adapter.build_args({ session_key: "test", add_dirs: ["/data"] });
    expect(args).toContain("--add-dir");
    expect(args).toContain("/data");
    const execIdx = args.indexOf("exec");
    const addDirIdx = args.indexOf("--add-dir");
    expect(addDirIdx).toBeLessThan(execIdx);
  });

  it("ephemeral을 --ephemeral로 전달한다 (exec flag)", () => {
    const args = adapter.build_args({ session_key: "test", ephemeral: true });
    expect(args).toContain("--ephemeral");
    const execIdx = args.indexOf("exec");
    const ephIdx = args.indexOf("--ephemeral");
    expect(ephIdx).toBeGreaterThan(execIdx);
  });

  it("stdin_mode가 close이다", () => {
    expect(adapter.stdin_mode).toBe("close");
  });

  it("format_input은 원시 텍스트 + 개행으로 포맷한다", () => {
    const out = adapter.format_input({ type: "user_message", content: "hi" });
    expect(out).toBe("hi\n");
  });
});

describe("GeminiCliAdapter", () => {
  let adapter: GeminiCliAdapter;
  beforeEach(() => { adapter = new GeminiCliAdapter(); });

  // ── parse_output ──

  it("init 이벤트에서 session_id를 캡처한다", () => {
    const msg = adapter.parse_output('{"type":"init","session_id":"gem-sess-001","model":"gemini-2.5-pro"}');
    expect(msg).toBeNull();
    expect(adapter.session_id).toBe("gem-sess-001");
  });

  it("assistant message를 assistant_chunk로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"message","role":"assistant","content":"hello gemini","delta":true}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("assistant_chunk");
    if (msg!.type === "assistant_chunk") {
      expect(msg!.content).toBe("hello gemini");
      expect(msg!.delta).toBe(true);
    }
  });

  it("user message는 무시한다", () => {
    const msg = adapter.parse_output('{"type":"message","role":"user","content":"hi"}');
    expect(msg).toBeNull();
  });

  it("빈 assistant content는 무시한다", () => {
    expect(adapter.parse_output('{"type":"message","role":"assistant","content":""}')).toBeNull();
  });

  it("tool_use를 tool_use로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"tool_use","tool_name":"Bash","tool_id":"bash-42","parameters":{"command":"ls -la"}}',
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("tool_use");
    if (msg!.type === "tool_use") {
      expect(msg!.tool).toBe("Bash");
      expect(msg!.input).toEqual({ command: "ls -la" });
    }
  });

  it("tool_result를 tool_result로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"tool_result","tool_name":"Bash","tool_id":"bash-42","status":"success","output":"file.txt"}',
    );
    expect(msg!.type).toBe("tool_result");
    if (msg!.type === "tool_result") {
      expect(msg!.tool).toBe("Bash");
      expect(msg!.output).toBe("file.txt");
    }
  });

  it("result를 complete로 변환한다", () => {
    const msg = adapter.parse_output(
      '{"type":"result","response":"done","stats":{"input_tokens":200,"output_tokens":80}}',
    );
    expect(msg!.type).toBe("complete");
    if (msg!.type === "complete") {
      expect(msg!.result).toBe("done");
      expect(msg!.usage).toEqual({ input: 200, output: 80 });
    }
  });

  it("error를 에러 메시지로 변환한다", () => {
    const msg = adapter.parse_output('{"type":"error","message":"quota exceeded"}');
    expect(msg!.type).toBe("error");
    if (msg!.type === "error") {
      expect(msg!.code).toBe("rate_limit");
      expect(msg!.message).toBe("quota exceeded");
    }
  });

  it("잘못된 JSON을 무시한다", () => {
    expect(adapter.parse_output("not json")).toBeNull();
  });

  it("빈 줄을 무시한다", () => {
    expect(adapter.parse_output("")).toBeNull();
    expect(adapter.parse_output("   ")).toBeNull();
  });

  // ── build_args ──

  it("--output-format stream-json과 --approval-mode yolo를 포함한다", () => {
    const args = adapter.build_args({ session_key: "test" });
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--approval-mode");
    expect(args).toContain("yolo");
  });

  it("model을 --model로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", model: "gemini-2.5-pro" });
    expect(args).toContain("--model");
    expect(args).toContain("gemini-2.5-pro");
  });

  it("UUID session_key를 --resume으로 전달한다", () => {
    const args = adapter.build_args({ session_key: "550e8400-e29b-41d4-a716-446655440000" });
    expect(args).toContain("--resume");
    expect(args).toContain("550e8400-e29b-41d4-a716-446655440000");
  });

  it("비-UUID session_key는 --resume을 생략한다", () => {
    const args = adapter.build_args({ session_key: "my-key" });
    expect(args).not.toContain("--resume");
  });

  it("allowed_tools를 --allowed-tools로 전달한다 (쉼표 구분)", () => {
    const args = adapter.build_args({ session_key: "test", allowed_tools: ["Bash", "ReadFile"] });
    expect(args).toContain("--allowed-tools");
    expect(args).toContain("Bash,ReadFile");
  });

  it("add_dirs를 --include-directories로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", add_dirs: ["/workspace", "/shared"] });
    expect(args).toContain("--include-directories");
    expect(args).toContain("/workspace");
    expect(args).toContain("/shared");
  });

  it("mcp_config를 --extensions로 전달한다", () => {
    const args = adapter.build_args({ session_key: "test", mcp_config: "./mcp.json" });
    expect(args).toContain("--extensions");
    expect(args).toContain("./mcp.json");
  });

  // ── 능력 플래그 ──

  it("supports_system_prompt_flag가 false이다", () => {
    expect(adapter.supports_system_prompt_flag).toBe(false);
  });

  it("supports_tool_filtering이 true이다", () => {
    expect(adapter.supports_tool_filtering).toBe(true);
  });

  it("stdin_mode가 close이다", () => {
    expect(adapter.stdin_mode).toBe("close");
  });

  it("format_input은 원시 텍스트 + 개행으로 포맷한다", () => {
    const out = adapter.format_input({ type: "user_message", content: "hi" });
    expect(out).toBe("hi\n");
  });

  // ── 에러 코드 분류 ──

  it("auth 에러를 분류한다", () => {
    const msg = adapter.parse_output('{"type":"error","message":"unauthorized access"}');
    if (msg?.type === "error") expect(msg.code).toBe("auth");
  });

  it("token limit 에러를 분류한다", () => {
    const msg = adapter.parse_output('{"type":"error","message":"context window exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("token_limit");
  });

  it("billing 에러를 분류한다", () => {
    const msg = adapter.parse_output('{"type":"error","message":"billing issue"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — 다중 content block
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 다중 content block → 배열 반환", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("text + tool_use 두 블록 → AgentOutputMessage[] 배열 반환", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I will call a tool." },
          { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "/etc/hosts" } },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as any[];
    expect(arr.length).toBe(2);
    expect(arr[0].type).toBe("assistant_chunk");
    expect(arr[1].type).toBe("tool_use");
    expect(arr[1].tool).toBe("read_file");
  });

  it("세 개 블록 (text + tool_use + text) → 길이 3 배열", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "start" },
          { type: "tool_use", id: "tu-2", name: "exec", input: {} },
          { type: "text", text: "end" },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(3);
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — 빈 / 미인식 content_blocks
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 빈 content_blocks → null", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("content_blocks 빈 배열 → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("content_blocks undefined → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {},
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("text 블록 text 값이 빈 문자열 → messages.length=0 → null", () => {
    // text="" → push 안 함 (if (text) 조건), 다른 블록 없음 → messages.length=0
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "" },
        ],
      },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("미인식 블록 타입만 있을 때 → messages.length=0 → null", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "unknown_block", data: "xyz" },
        ],
      },
    });
    expect(adapter.parse_output(line)).toBeNull();
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — root user (getuid = 0)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — root user (getuid=0) → --dangerously-skip-permissions 생략", () => {
  it("process.getuid()=0 시 --dangerously-skip-permissions 포함 안 됨", () => {
    const adapter = new ClaudeCliAdapter();
    // getuid를 0으로 임시 재정의 (root 시뮬레이션)
    const orig_getuid = (process as any).getuid;
    (process as any).getuid = () => 0;
    try {
      const args = adapter.build_args({ session_key: "test" });
      expect(args).not.toContain("--dangerously-skip-permissions");
    } finally {
      if (orig_getuid === undefined) {
        delete (process as any).getuid;
      } else {
        (process as any).getuid = orig_getuid;
      }
    }
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — parse_output 엣지 케이스
// ══════════════════════════════════════════

describe("CodexCliAdapter — parse_output 엣지 케이스", () => {
  it("잘못된 JSON → catch → null (L187)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output("not valid json")).toBeNull();
  });

  it("미인식 type → null (L220)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output('{"type":"unknown_codex_event"}')).toBeNull();
  });
});

describe("CodexCliAdapter — extract_tool_input 비 arguments 필드", () => {
  let adapter: CodexCliAdapter;
  beforeEach(() => { adapter = new CodexCliAdapter(); });

  it("arguments 필드 없고 개별 필드 있음 → rest spread로 추출", () => {
    // item에 type, call_id, id, status 제외한 나머지 필드 추출
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "custom_op",
        call_id: "cid-1",
        id: "id-1",
        status: "running",
        file_path: "/tmp/work.py",
        line_count: 42,
      },
    });
    const msg = adapter.parse_output(line);
    expect(msg?.type).toBe("tool_use");
    if (msg?.type === "tool_use") {
      const input = msg.input as Record<string, unknown>;
      // type, call_id, id, status 제거됨
      expect(input.file_path).toBe("/tmp/work.py");
      expect(input.line_count).toBe(42);
      expect(input.type).toBeUndefined();
      expect(input.call_id).toBeUndefined();
    }
  });

  it("arguments가 유효한 JSON 문자열 → JSON.parse 결과 반환", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "apply_patch",
        arguments: JSON.stringify({ patch: "--- a\\n+++ b", target: "file.ts" }),
      },
    });
    const msg = adapter.parse_output(line);
    if (msg?.type === "tool_use") {
      const input = msg.input as Record<string, unknown>;
      expect(input.patch).toContain("--- a");
      expect(input.target).toBe("file.ts");
    }
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — build_developer_instructions tool_definitions
// ══════════════════════════════════════════

describe("CodexCliAdapter — build_args tool_definitions 경로", () => {
  it("tool_definitions → developer_instructions에 포함됨", () => {
    const adapter = new CodexCliAdapter();
    const defs = "read_file: reads a file";
    const args = adapter.build_args({ session_key: "test", tool_definitions: defs });
    // --config developer_instructions=... 인자 확인
    const config_idx = args.indexOf("--config");
    expect(config_idx).toBeGreaterThan(-1);
    const config_val = args[config_idx + 1];
    expect(config_val).toContain("## Tools");
    expect(config_val).toContain(defs);
  });

  it("system_prompt + tool_definitions 조합 → 모두 포함됨", () => {
    const adapter = new CodexCliAdapter();
    const args = adapter.build_args({
      session_key: "test",
      system_prompt: "You are a helpful bot.",
      tool_definitions: "exec: runs shell commands",
    });
    const config_idx = args.indexOf("--config");
    expect(config_idx).toBeGreaterThan(-1);
    const config_val = args[config_idx + 1];
    expect(config_val).toContain("You are a helpful bot.");
    expect(config_val).toContain("exec: runs shell commands");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — message role 분기
// ══════════════════════════════════════════

describe("GeminiCliAdapter — message role !== 'assistant' → null", () => {
  let adapter: GeminiCliAdapter;
  beforeEach(() => { adapter = new GeminiCliAdapter(); });

  it("role='user' → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "user",
      content: "human message",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("role='system' → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "system",
      content: "system message",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });

  it("content 빈 문자열 → null 반환", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "",
      delta: true,
    });
    expect(adapter.parse_output(line)).toBeNull();
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — result response fallback
// ══════════════════════════════════════════

describe("GeminiCliAdapter — result: last_text 없을 때 response fallback", () => {
  it("assistant 메시지 없이 result → parsed.response 사용", () => {
    const adapter = new GeminiCliAdapter();
    // last_text 누적 없이 result
    const msg = adapter.parse_output('{"type":"result","response":"direct response","stats":{"input_tokens":10,"output_tokens":5}}');
    expect(msg?.type).toBe("complete");
    if (msg?.type === "complete") {
      expect(msg.result).toBe("direct response");
      expect(msg.usage?.input).toBe(10);
    }
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — rate error 분류
// ══════════════════════════════════════════

describe("GeminiCliAdapter — rate_limit 에러 (rate 포함)", () => {
  it("'rate limit exceeded' → rate_limit 코드", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"rate limit exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — init 세션 리셋
// ══════════════════════════════════════════

describe("GeminiCliAdapter — init 이벤트: session_id + last_text 리셋", () => {
  it("init → session_id 저장, last_text 초기화", () => {
    const adapter = new GeminiCliAdapter();
    // 먼저 last_text 축적
    adapter.parse_output('{"type":"message","role":"assistant","content":"old text","delta":true}');
    // init → 리셋
    const r = adapter.parse_output('{"type":"init","session_id":"sess-999","model":"gemini-pro"}');
    expect(r).toBeNull();
    expect(adapter.session_id).toBe("sess-999");
    // result에서 last_text가 비어 있으므로 response 사용
    const complete = adapter.parse_output('{"type":"result","response":"fresh start"}');
    if (complete?.type === "complete") {
      expect(complete.result).toBe("fresh start");
    }
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — messages.length===1 (L102) + tool_result 처리
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — messages.length===1 → 단일 메시지 반환 (배열 아님)", () => {
  it("tool_use 블록 하나 → 배열 아닌 단일 AgentOutputMessage 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu-single", name: "read_file", input: { path: "/etc/hosts" } },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(Array.isArray(result)).toBe(false);
    expect(result?.type).toBe("tool_use");
  });

  it("tool_result 블록 (content 문자열) → tool_result 메시지 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-1", content: "file content here" },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toBe("file content here");
  });

  it("tool_result 블록 (content 배열) → 텍스트 추출 후 join", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-2",
            content: [
              { type: "text", text: "line one" },
              { type: "text", text: "line two" },
            ],
          },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toContain("line one");
  });

  it("tool_result 블록 (content 숫자/기타) → String() fallback", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-3", content: 42 },
        ],
      },
    });
    const result = adapter.parse_output(line);
    expect(result?.type).toBe("tool_result");
    if (result?.type === "tool_result") expect(result.output).toBe("42");
  });
});

// ══════════════════════════════════════════
// CodexCliAdapter — parse_item return null (L273)
// ══════════════════════════════════════════

describe("CodexCliAdapter — parse_item return null 경로 (L273)", () => {
  it("item 없음 (undefined) → null", () => {
    const adapter = new CodexCliAdapter();
    // item 필드 없으면 parse_item(undefined, ...) → null
    const result = adapter.parse_output('{"type":"item.started"}');
    expect(result).toBeNull();
  });

  it("item.type=agent_message + event=item.started → null (L273)", () => {
    const adapter = new CodexCliAdapter();
    // agent_message는 item.completed 시에만 처리됨 → item.started는 null
    const result = adapter.parse_output('{"type":"item.started","item":{"type":"agent_message","text":"hi"}}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// ClaudeCliAdapter — parse_output 미인식 type (L120)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — 미인식 type → null (L120)", () => {
  it("알 수 없는 type → null 반환", () => {
    const adapter = new ClaudeCliAdapter();
    const result = adapter.parse_output('{"type":"unknown_event","data":"xyz"}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// extract_tool_result_text — 배열 내 비 text-type 항목 처리 (L288)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — tool_result 배열 내 혼합 항목 처리 (L288)", () => {
  it("배열 내 비 text 항목 → '' (filter 후 제거)", () => {
    const adapter = new ClaudeCliAdapter();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-mixed",
            content: [
              { type: "image", url: "https://example.com/img.png" },  // non-text type
              { type: "text", text: "actual text" },
            ],
          },
        ],
      },
    });
    const result = adapter.parse_output(line);
    if (result?.type === "tool_result") expect(result.output).toBe("actual text");
  });
});

// ══════════════════════════════════════════
// GeminiCliAdapter — 미인식 type → return null (L428)
// ══════════════════════════════════════════

describe("GeminiCliAdapter — 미인식 type → null 반환 (L428)", () => {
  it("unknown type → null", () => {
    const adapter = new GeminiCliAdapter();
    const result = adapter.parse_output('{"type":"unknown_event","data":"xyz"}');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// map_gemini_error_code — billing + fatal 에러 (L441-443)
// ══════════════════════════════════════════

describe("GeminiCliAdapter — billing + fatal 에러 분기", () => {
  it("'billing issue' → billing 코드 (L441)", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"billing issue, please check your account"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("알 수 없는 에러 → fatal 코드 (L443)", () => {
    const adapter = new GeminiCliAdapter();
    const msg = adapter.parse_output('{"type":"error","message":"some unexpected service error occurred"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });
});

// ══════════════════════════════════════════
// map_claude_error_code — rate/billing/fatal 분기 (L300-302)
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — map_claude_error_code rate/billing/fatal 분기", () => {
  it("rate 에러 → rate_limit 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"rate limit exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("rate_limit");
  });

  it("billing 에러 → billing 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"billing quota exceeded"}');
    if (msg?.type === "error") expect(msg.code).toBe("billing");
  });

  it("알 수 없는 에러 → fatal 코드", () => {
    const adapter = new ClaudeCliAdapter();
    const msg = adapter.parse_output('{"type":"error","error":"unexpected service failure"}');
    if (msg?.type === "error") expect(msg.code).toBe("fatal");
  });
});

describe("CodexCliAdapter — parse_output 빈 줄 (L183)", () => {
  it("빈 줄 → null 반환 (L183)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.parse_output("")).toBeNull();
    expect(adapter.parse_output("   ")).toBeNull();
  });
});

// ══════════════════════════════════════════
// Claude — result without usage, 주석 줄, error message fallback
// ══════════════════════════════════════════

describe("ClaudeCliAdapter — parse_output 추가 분기", () => {
  let adapter: ClaudeCliAdapter;
  beforeEach(() => { adapter = new ClaudeCliAdapter(); });

  it("result without usage → usage=undefined", () => {
    const msg = adapter.parse_output('{"type":"result","result":"done"}');
    expect(msg).not.toBeNull();
    if (msg?.type === "complete") {
      expect(msg.usage).toBeUndefined();
    }
  });

  it("주석 줄 → null", () => {
    expect(adapter.parse_output("// this is a comment")).toBeNull();
  });

  it("error 메시지 필드 fallback (message 대신 error 필드 없음)", () => {
    const msg = adapter.parse_output('{"type":"error","message":"invalid api key"}');
    if (msg?.type === "error") expect(msg.code).toBe("auth");
  });
});

// ══════════════════════════════════════════
// Codex — 추가 분기 (turn.started, apply_patch JSON parse 실패, aggregated_output fallback, unknown item_type)
// ══════════════════════════════════════════

describe("CodexCliAdapter — 추가 분기", () => {
  let adapter: CodexCliAdapter;
  beforeEach(() => { adapter = new CodexCliAdapter(); });

  it("turn.started → null 반환", () => {
    expect(adapter.parse_output('{"type":"turn.started"}')).toBeNull();
  });

  it("apply_patch: arguments JSON parse 실패 → raw arguments 필드로 반환", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.started",
      item: { type: "apply_patch", arguments: "{invalid json" },
    }));
    if (msg?.type === "tool_use") {
      expect((msg.input as Record<string, unknown>).arguments).toBe("{invalid json");
    }
  });

  it("item.completed apply_patch에 aggregated_output fallback", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.completed",
      item: { type: "apply_patch", aggregated_output: "fallback output" },
    }));
    if (msg?.type === "tool_result") {
      expect(msg.output).toBe("fallback output");
    }
  });

  it("item.started with unknown item_type → tool_use로 반환", () => {
    const msg = adapter.parse_output(JSON.stringify({
      type: "item.started",
      item: { type: "custom_tool", param1: "value1", param2: "value2" },
    }));
    expect(msg?.type).toBe("tool_use");
    if (msg?.type === "tool_use") {
      expect(msg.tool).toBe("custom_tool");
      expect((msg.input as Record<string, unknown>).param1).toBe("value1");
    }
  });
});

// ══════════════════════════════════════════
// Gemini — result without stats, last_text 우선
// ══════════════════════════════════════════

describe("GeminiCliAdapter — 추가 분기", () => {
  let adapter: GeminiCliAdapter;
  beforeEach(() => { adapter = new GeminiCliAdapter(); });

  it("result without stats → usage undefined", () => {
    const msg = adapter.parse_output('{"type":"result","response":"done"}');
    if (msg?.type === "complete") expect(msg.usage).toBeUndefined();
  });

  it("result: last_text가 있으면 response보다 우선 사용", () => {
    adapter.parse_output('{"type":"message","role":"assistant","content":"accumulated text","delta":true}');
    const msg = adapter.parse_output('{"type":"result","response":"response text"}');
    if (msg?.type === "complete") {
      expect(msg.result).toBe("accumulated text");
    }
  });
});
