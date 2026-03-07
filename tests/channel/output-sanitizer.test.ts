import { describe, it, expect } from "vitest";
import {
  is_provider_noise_line,
  is_stream_noise_line,
  is_tool_protocol_leak_line,
  is_persona_leak_line,
  is_sensitive_command_line,
  strip_tool_protocol_leaks,
  strip_persona_leak_blocks,
  sanitize_provider_output,
  sanitize_stream_chunk,
  normalize_agent_reply,
  extract_provider_error,
  is_provider_error_reply,
  strip_ansi,
  strip_secret_reference_tokens,
} from "@src/channels/output-sanitizer.js";

describe("is_provider_noise_line", () => {
  it("preserves empty lines (paragraph breaks)", () => {
    expect(is_provider_noise_line("")).toBe(false);
    expect(is_provider_noise_line("   ")).toBe(false);
  });

  it("detects orchestrator prefixes", () => {
    expect(is_provider_noise_line("orchestrator direct processing")).toBe(true);
    expect(is_provider_noise_line("오케스트레이터 직접 처리")).toBe(true);
  });

  it("detects execution mode lines", () => {
    expect(is_provider_noise_line("execution mode: once")).toBe(true);
    expect(is_provider_noise_line("mode = agent")).toBe(true);
  });

  it("detects Codex version lines", () => {
    expect(is_provider_noise_line("OpenAI Codex v1.2.3")).toBe(true);
  });

  it("detects timestamp log lines", () => {
    expect(is_provider_noise_line("2024-01-01T12:00:00 codex_core::something")).toBe(true);
  });

  it("passes normal text through", () => {
    expect(is_provider_noise_line("Hello, how can I help?")).toBe(false);
    expect(is_provider_noise_line("The answer is 42")).toBe(false);
  });

  it("detects tool protocol leaks as noise", () => {
    expect(is_provider_noise_line('tool_calls: [1 item]')).toBe(true);
  });
});

describe("is_stream_noise_line", () => {
  it("preserves empty lines as paragraph breaks", () => {
    expect(is_stream_noise_line("")).toBe(false);
    expect(is_stream_noise_line("   ")).toBe(false);
  });

  it("delegates to is_provider_noise_line for non-empty", () => {
    expect(is_stream_noise_line("orchestrator direct processing")).toBe(true);
    expect(is_stream_noise_line("Hello")).toBe(false);
  });
});

describe("is_tool_protocol_leak_line", () => {
  it("detects tool_calls JSON at line start", () => {
    expect(is_tool_protocol_leak_line('"tool_calls": [')).toBe(true);
    expect(is_tool_protocol_leak_line('  {"tool_call_id": "abc"}')).toBe(true);
  });

  it("detects call IDs at line start", () => {
    expect(is_tool_protocol_leak_line('"id": "call_abc123",')).toBe(true);
    expect(is_tool_protocol_leak_line('"id": "call_abc123"}')).toBe(true);
  });

  it("passes normal text and mid-line mentions", () => {
    expect(is_tool_protocol_leak_line("I'll search for that")).toBe(false);
    expect(is_tool_protocol_leak_line('the "id" field contains "call_abc"')).toBe(false);
  });
});

describe("is_persona_leak_line", () => {
  it("detects instruction tags", () => {
    expect(is_persona_leak_line("<instructions>")).toBe(true);
    expect(is_persona_leak_line("</instructions>")).toBe(true);
  });

  it("detects identity statements", () => {
    expect(is_persona_leak_line("you are Codex, an AI assistant")).toBe(true);
    expect(is_persona_leak_line("You are ChatGPT and you help")).toBe(true);
  });

  it("detects role headers", () => {
    expect(is_persona_leak_line("role: system")).toBe(true);
    expect(is_persona_leak_line("# Identity")).toBe(true);
  });

  it("detects config file references", () => {
    expect(is_persona_leak_line("see AGENTS.md for details")).toBe(true);
  });

  it("passes normal text", () => {
    expect(is_persona_leak_line("I'm a developer")).toBe(false);
  });
});

describe("is_sensitive_command_line", () => {
  it("detects shell prompts", () => {
    expect(is_sensitive_command_line("PS C:\\Users\\test>")).toBe(true);
    expect(is_sensitive_command_line("$ git status")).toBe(true);
  });

  it("detects env variable assignments", () => {
    expect(is_sensitive_command_line("$env:API_KEY=abc")).toBe(true);
    expect(is_sensitive_command_line("export API_KEY=abc")).toBe(true);
  });

  it("passes normal text and standalone command names", () => {
    expect(is_sensitive_command_line("The file contains data")).toBe(false);
    expect(is_sensitive_command_line("git은 버전 관리 도구입니다")).toBe(false);
    expect(is_sensitive_command_line("npm으로 설치하세요")).toBe(false);
    expect(is_sensitive_command_line("```bash")).toBe(false);
  });
});

describe("strip_tool_protocol_leaks", () => {
  it("removes ORCH_TOOL_CALLS blocks", () => {
    const input = "before\n<<ORCH_TOOL_CALLS>>\n{some json}\n<<ORCH_TOOL_CALLS_END>>\nafter";
    const result = strip_tool_protocol_leaks(input);
    expect(result).not.toContain("ORCH_TOOL_CALLS");
    expect(result).not.toContain("{some json}");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("removes individual leak lines", () => {
    const input = 'line1\n"tool_calls": [\nline2';
    expect(strip_tool_protocol_leaks(input)).toBe("line1\nline2");
  });

  it("returns empty for empty input", () => {
    expect(strip_tool_protocol_leaks("")).toBe("");
  });
});

describe("strip_persona_leak_blocks", () => {
  it("removes code blocks referencing config files", () => {
    const input = "start\n```\nSee AGENTS.md\n```\nend";
    expect(strip_persona_leak_blocks(input)).toBe("start\n\nend");
  });

  it("removes Codex identity blocks", () => {
    const input = "start\n```\nYou are Codex\n```\nend";
    expect(strip_persona_leak_blocks(input)).toBe("start\n\nend");
  });
});

describe("sanitize_provider_output", () => {
  it("combines all filters", () => {
    const input = "Hello\norchestrator direct\n\"tool_calls\": [\nresult text";
    const output = sanitize_provider_output(input);
    expect(output).toBe("Hello\nresult text");
  });

  it("strips ANSI codes", () => {
    const output = sanitize_provider_output("\x1B[32mgreen\x1B[0m text");
    expect(output).toBe("green text");
  });

  it("redacts secret references", () => {
    const output = sanitize_provider_output("key={{ secret:API_KEY }}");
    expect(output).toContain("[REDACTED:SECRET_REF]");
  });

  it("returns empty for empty input", () => {
    expect(sanitize_provider_output("")).toBe("");
  });

  it("preserves tool/command names in natural language responses", () => {
    const input = "사용 가능한 도구:\n\ngit - 버전 관리\nnpm - 패키지 관리\necho - 메시지 출력";
    const output = sanitize_provider_output(input);
    expect(output).toContain("git - 버전 관리");
    expect(output).toContain("npm - 패키지 관리");
    expect(output).toContain("echo - 메시지 출력");
  });

  it("preserves paragraph breaks (empty lines)", () => {
    const input = "첫 번째 단락\n\n두 번째 단락";
    const output = sanitize_provider_output(input);
    expect(output).toContain("\n\n");
  });
});

describe("code block preservation", () => {
  it("preserves tool protocol patterns inside code blocks", () => {
    const input = 'Here is the JSON:\n```json\n{"tool_calls": [{"id": "call_abc123"}]}\n```\nDone.';
    const output = sanitize_provider_output(input);
    expect(output).toContain('"tool_calls"');
    expect(output).toContain('"call_abc123"');
  });

  it("preserves shell commands inside code blocks", () => {
    const input = "Run this:\n```bash\ngit commit -m 'fix'\nnpm run build\n```";
    const output = sanitize_stream_chunk(input);
    expect(output).toContain("git commit");
    expect(output).toContain("npm run build");
  });

  it("preserves HTML inside code blocks", () => {
    const input = "Example:\n```html\n<div><strong>bold</strong></div>\n```";
    const output = sanitize_provider_output(input);
    expect(output).toContain("<div>");
    expect(output).toContain("<strong>");
  });

  it("still filters noise outside code blocks", () => {
    const input = "Hello\norchestrator direct processing\n```\nsafe content\n```\nDone";
    const output = sanitize_provider_output(input);
    expect(output).not.toContain("orchestrator direct");
    expect(output).toContain("safe content");
    expect(output).toContain("Hello");
    expect(output).toContain("Done");
  });
});

describe("sanitize_stream_chunk", () => {
  it("preserves long content without truncation", () => {
    const long = "a".repeat(1500);
    const result = sanitize_stream_chunk(long);
    expect(result.length).toBe(1500);
  });

  it("filters noise lines", () => {
    const input = "content\nOpenAI Codex v1.0\nmore content";
    expect(sanitize_stream_chunk(input)).toBe("content\nmore content");
  });
});

describe("normalize_agent_reply", () => {
  it("strips leading mention chains", () => {
    const result = normalize_agent_reply("@user1 @user2 hello", "bot", "user1");
    expect(result).toBe("hello");
  });

  it("strips self-intro patterns (multiline)", () => {
    const result = normalize_agent_reply("안녕하세요, @mybot입니다!\n무엇을 도와드릴까요?", "mybot", "sender");
    expect(result).toBe("무엇을 도와드릴까요?");
  });

  it("returns null when self-intro is entire content", () => {
    const result = normalize_agent_reply("안녕하세요, @mybot입니다!", "mybot", "sender");
    // self-intro만 있는 경우 persona leak 방지를 위해 null 반환
    expect(result).toBeNull();
  });

  it("strips English self-intro (multiline)", () => {
    const result = normalize_agent_reply("Hello, I'm mybot!\nHow can I help?", "mybot", "sender");
    expect(result).toBe("How can I help?");
  });

  it("strips Korean model identity intro (코덱스)", () => {
    const result = normalize_agent_reply("저는 코덱스(Codex)라는 AI 코딩 도우미예요. 무엇을 도와드릴까요?", "bot", "");
    expect(result).toBe("무엇을 도와드릴까요?");
  });

  it("returns null when Korean model identity intro is entire content", () => {
    expect(normalize_agent_reply("저는 코덱스(Codex)라는 AI 코딩 도우미입니다.", "bot", "")).toBeNull();
  });

  it("strips Korean variant model intros (챗지피티, 클로드, 제미니)", () => {
    expect(normalize_agent_reply("저는 챗지피티라는 AI 도우미입니다. 도와드릴게요.", "bot", "")).toBe("도와드릴게요.");
    expect(normalize_agent_reply("나는 클로드라는 AI 어시스턴트입니다. 질문하세요.", "bot", "")).toBe("질문하세요.");
    expect(normalize_agent_reply("저는 제미니라는 AI 비서예요. 말씀하세요.", "bot", "")).toBe("말씀하세요.");
  });

  it("strips maker-based intro (OpenAI/Anthropic/Google에서 만든)", () => {
    expect(normalize_agent_reply("저는 OpenAI에서 만든 AI입니다. 무엇을 도와드릴까요?", "bot", "")).toBe("무엇을 도와드릴까요?");
    expect(normalize_agent_reply("나는 Anthropic이 개발한 AI 어시스턴트입니다. 질문하세요.", "bot", "")).toBe("질문하세요.");
  });

  it("strips sender mention echo", () => {
    const result = normalize_agent_reply("@sender123 here is the answer", "bot", "sender123");
    expect(result).toBe("here is the answer");
  });

  it("returns null for provider errors", () => {
    expect(normalize_agent_reply("error calling claude: timeout", "bot", "")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(normalize_agent_reply("", "bot", "")).toBeNull();
  });
});

describe("extract_provider_error", () => {
  it("parses error format", () => {
    const result = extract_provider_error("Error calling claude: rate limit exceeded");
    expect(result).toBe("rate limit exceeded");
  });

  it("returns provider name when no body", () => {
    const result = extract_provider_error("Error calling chatgpt:");
    expect(result).toBe("provider_error:chatgpt");
  });

  it("returns null for non-error text", () => {
    expect(extract_provider_error("Hello world")).toBeNull();
  });
});

describe("is_provider_error_reply", () => {
  it("detects provider error indicators", () => {
    expect(is_provider_error_reply("error calling claude: something")).toBe(true);
    expect(is_provider_error_reply("error calling chatgpt: timeout")).toBe(true);
    expect(is_provider_error_reply("not logged in")).toBe(true);
    expect(is_provider_error_reply("please run /login")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(is_provider_error_reply("Hello world")).toBe(false);
  });
});

describe("strip_ansi", () => {
  it("removes ANSI escape sequences", () => {
    expect(strip_ansi("\x1B[31mred\x1B[0m")).toBe("red");
  });
});

describe("strip_secret_reference_tokens", () => {
  it("redacts {{ secret:* }} patterns", () => {
    expect(strip_secret_reference_tokens("key={{ secret:MY_KEY }}")).toContain("[REDACTED:SECRET_REF]");
  });

  it("redacts sv1 ciphertext tokens", () => {
    expect(strip_secret_reference_tokens("sv1.abc_def.ghi_jkl.mno_pqr")).toContain("[REDACTED:CIPHERTEXT]");
  });
});
