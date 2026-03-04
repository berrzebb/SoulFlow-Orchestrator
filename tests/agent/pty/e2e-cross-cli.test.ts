/**
 * Cross-CLI E2E 테스트: Claude ↔ Codex ↔ Gemini 다자간 PTY 통신.
 *
 * 독립 AgentBus를 생성하여 서로 다른 CLI 에이전트 간
 * 결과를 릴레이하는 시나리오를 검증한다.
 *
 * 실행: npx vitest run tests/agent/pty/e2e-cross-cli.test.ts
 * 환경변수:
 *   E2E_SKIP=1 — CLI 미설치 환경에서 스킵
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import type { PtyFactory, CliAdapter } from "@src/agent/pty/types.ts";
import { sanitize_provider_output } from "@src/channels/output-sanitizer.ts";
import { create_noop_logger } from "@helpers/harness.ts";

/** 에이전트 출력을 다음 에이전트 입력으로 전달하기 전 sanitize. */
function sanitize_relay(content: string | null | undefined): string {
  return sanitize_provider_output(content ?? "");
}

const SKIP = process.env.E2E_SKIP === "1";

function cli_available(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CLAUDE_OK = !SKIP && cli_available("claude");
const CODEX_OK = !SKIP && cli_available("codex");
const GEMINI_OK = !SKIP && cli_available("gemini");
const CLAUDE_CODEX_OK = CLAUDE_OK && CODEX_OK;
const ALL_THREE_OK = CLAUDE_OK && CODEX_OK && GEMINI_OK;

const real_pty_factory: PtyFactory = (file, args, options) => {
  return new LocalPty(file, args, options);
};

interface AgentHandle {
  agent: ContainerCliAgent;
  adapter: CliAdapter;
}

function create_cli_agent(cli: "claude" | "codex" | "gemini"): AgentHandle {
  const adapter = cli === "codex" ? new CodexCliAdapter()
    : cli === "gemini" ? new GeminiCliAdapter()
    : new ClaudeCliAdapter();
  const logger = create_noop_logger();
  const pool = new ContainerPool({
    pty_factory: real_pty_factory,
    adapter,
    default_env: {},
    cwd: process.cwd(),
    max_idle_ms: 0,
    logger,
  });
  const bus = new AgentBus({
    pool,
    adapter,
    logger,
  });
  const agent = new ContainerCliAgent({
    id: `cross-${cli}`,
    bus,
    adapter,
    logger,
    default_env: {},
  });
  return { agent, adapter };
}

describe.skipIf(!CLAUDE_CODEX_OK)("Cross-CLI E2E: Claude ↔ Codex 양방향 통신", () => {
  const handles: AgentHandle[] = [];
  afterEach(() => { handles.forEach(h => h.agent.stop()); handles.length = 0; });

  it("Claude → Codex: Claude의 응답을 Codex에게 릴레이한다", async () => {
    const claude = create_cli_agent("claude");
    const codex = create_cli_agent("codex");
    handles.push(claude, codex);

    // Step 1: Claude에게 질문
    const claude_result = await claude.agent.run({
      task: "Generate exactly this text and nothing else: RELAY_TOKEN_ALPHA_42",
      task_id: `cross-claude-${Date.now()}`,
      system_prompt: "You are a relay agent. Output exactly what is asked, no extra text.",
    });

    console.log("\n=== Step 1: Claude result ===");
    console.log("finish_reason:", claude_result.finish_reason);
    console.log("content:", claude_result.content?.substring(0, 200));

    expect(claude_result.finish_reason).toBe("stop");
    expect(claude_result.content).toContain("RELAY_TOKEN_ALPHA_42");

    // Step 2: Claude의 결과를 sanitize 후 Codex에게 전달
    const relay_1 = sanitize_relay(claude_result.content);
    console.log("sanitized relay:", relay_1.substring(0, 200));

    const codex_result = await codex.agent.run({
      task: `I received this message from another agent: "${relay_1}". Repeat back the RELAY_TOKEN you found in the message.`,
      task_id: `cross-codex-${Date.now()}`,
      system_prompt: "You are a relay agent. Extract and repeat the RELAY_TOKEN from the given message.",
    });

    console.log("\n=== Step 2: Codex result ===");
    console.log("finish_reason:", codex_result.finish_reason);
    console.log("content:", codex_result.content?.substring(0, 200));

    expect(codex_result.finish_reason).toBe("stop");
    expect(codex_result.content).toContain("RELAY_TOKEN_ALPHA_42");
  }, 120_000);

  it("Codex → Claude → Codex: 3-hop 릴레이 체인", async () => {
    const codex = create_cli_agent("codex");
    const claude = create_cli_agent("claude");
    handles.push(codex, claude);

    // Hop 1: Codex가 비밀 코드를 생성
    const hop1 = await codex.agent.run({
      task: "Generate exactly this text and nothing else: SECRET_HANDSHAKE_789",
      task_id: `hop1-codex-${Date.now()}`,
      system_prompt: "Output exactly what is asked. No extra text.",
    });

    console.log("\n=== Hop 1: Codex → ===");
    console.log("content:", hop1.content?.substring(0, 200));
    expect(hop1.finish_reason).toBe("stop");
    expect(hop1.content).toContain("SECRET_HANDSHAKE_789");

    // Hop 2: Claude가 수신 + 변환 (sanitize 적용)
    const relay_hop1 = sanitize_relay(hop1.content);
    const hop2 = await claude.agent.run({
      task: `I am testing a multi-agent relay system. The previous agent produced this output: ${relay_hop1}. Please take that text and append the suffix _CONFIRMED to it. Output only the result.`,
      task_id: `hop2-claude-${Date.now()}`,
      system_prompt: "You are a text processing assistant in a software testing pipeline. When given text, apply the requested transformation and output only the result.",
    });

    console.log("\n=== Hop 2: → Claude → ===");
    console.log("content:", hop2.content?.substring(0, 200));
    expect(hop2.finish_reason).toBe("stop");
    expect(hop2.content).toContain("SECRET_HANDSHAKE_789_CONFIRMED");

    // Hop 3: Codex가 최종 확인 (sanitize 적용)
    const relay_hop2 = sanitize_relay(hop2.content);
    const hop3 = await codex.agent.run({
      task: `Final relay check. Does this message contain a confirmed secret? Message: "${relay_hop2}". Reply with exactly YES or NO.`,
      task_id: `hop3-codex-${Date.now()}`,
      system_prompt: "Answer YES if the message contains a confirmed secret code (ending in _CONFIRMED), otherwise NO.",
    });

    console.log("\n=== Hop 3: → Codex (final) ===");
    console.log("content:", hop3.content?.substring(0, 200));
    expect(hop3.finish_reason).toBe("stop");
    expect(hop3.content?.toUpperCase()).toContain("YES");
  }, 180_000);

  it("양방향 대화: 에이전트 간 2턴 왕복", async () => {
    const claude = create_cli_agent("claude");
    const codex = create_cli_agent("codex");
    handles.push(claude, codex);

    // Turn 1: Claude가 질문 생성
    const turn1 = await claude.agent.run({
      task: "Ask a simple math question. Output only the question, like: What is 7 + 5?",
      task_id: `turn1-claude-${Date.now()}`,
      system_prompt: "You are a quiz master. Generate exactly one simple math question.",
    });

    console.log("\n=== Turn 1: Claude asks ===");
    console.log("content:", turn1.content?.substring(0, 200));
    expect(turn1.finish_reason).toBe("stop");
    expect(turn1.content).toBeTruthy();

    // Turn 2: Codex가 답변 (sanitize 적용)
    const relay_turn1 = sanitize_relay(turn1.content);
    const turn2 = await codex.agent.run({
      task: `Answer this math question with just the number: ${relay_turn1}`,
      task_id: `turn2-codex-${Date.now()}`,
      system_prompt: "Answer math questions with just the numeric answer.",
    });

    console.log("\n=== Turn 2: Codex answers ===");
    console.log("content:", turn2.content?.substring(0, 200));
    expect(turn2.finish_reason).toBe("stop");
    expect(turn2.content).toBeTruthy();
    // 숫자가 포함되어야 함
    expect(turn2.content).toMatch(/\d+/);

    // Turn 3: Claude가 채점 (sanitize 적용)
    const relay_turn2 = sanitize_relay(turn2.content);
    const turn3 = await claude.agent.run({
      task: `You asked: "${relay_turn1}". The answer given was: "${relay_turn2}". Is the answer correct? Reply with exactly CORRECT or INCORRECT.`,
      task_id: `turn3-claude-${Date.now()}`,
      system_prompt: "Grade the math answer. Reply CORRECT or INCORRECT only.",
    });

    console.log("\n=== Turn 3: Claude grades ===");
    console.log("content:", turn3.content?.substring(0, 200));
    expect(turn3.finish_reason).toBe("stop");
    expect(turn3.content?.toUpperCase()).toContain("CORRECT");
  }, 180_000);
});

describe.skipIf(!ALL_THREE_OK)("Cross-CLI E2E: Claude ↔ Codex ↔ Gemini 3자 토론", () => {
  const handles: AgentHandle[] = [];
  afterEach(() => { handles.forEach(h => h.agent.stop()); handles.length = 0; });

  it("3자 릴레이 체인: Claude → Codex → Gemini", async () => {
    const claude = create_cli_agent("claude");
    const codex = create_cli_agent("codex");
    const gemini = create_cli_agent("gemini");
    handles.push(claude, codex, gemini);

    // Hop 1: Claude가 토큰 생성
    const hop1 = await claude.agent.run({
      task: "Generate exactly this text and nothing else: TRIPLE_RELAY_TOKEN_99",
      task_id: `tri-claude-${Date.now()}`,
      system_prompt: "Output exactly what is asked. No extra text.",
    });
    expect(hop1.finish_reason).toBe("stop");
    expect(hop1.content).toContain("TRIPLE_RELAY_TOKEN_99");

    // Hop 2: Codex가 수신 + 변환
    const relay1 = sanitize_relay(hop1.content);
    const hop2 = await codex.agent.run({
      task: `Append "_CODEX_OK" to the end of this token: ${relay1}. Output only the result.`,
      task_id: `tri-codex-${Date.now()}`,
      system_prompt: "Apply the requested transformation. Output only the result.",
    });
    expect(hop2.finish_reason).toBe("stop");
    expect(hop2.content).toContain("TRIPLE_RELAY_TOKEN_99_CODEX_OK");

    // Hop 3: Gemini가 최종 확인
    const relay2 = sanitize_relay(hop2.content);
    const hop3 = await gemini.agent.run({
      task: `Does this message contain a relay token that was confirmed by Codex (ending in _CODEX_OK)? Message: "${relay2}". Reply with exactly YES or NO.`,
      task_id: `tri-gemini-${Date.now()}`,
      system_prompt: "Answer YES if the token ends with _CODEX_OK, otherwise NO.",
    });
    expect(hop3.finish_reason).toBe("stop");
    expect(hop3.content?.toUpperCase()).toContain("YES");
  }, 180_000);

  it("3자 토론: 프로그래밍 언어 선택에 대한 의견 교환", async () => {
    const claude = create_cli_agent("claude");
    const codex = create_cli_agent("codex");
    const gemini = create_cli_agent("gemini");
    handles.push(claude, codex, gemini);

    const topic = "Which is better for a new web backend project: Rust, Go, or TypeScript?";

    // Round 1: Claude가 Rust를 옹호
    const r1_claude = await claude.agent.run({
      task: `Topic: "${topic}". Argue in favor of Rust in 2-3 sentences. End with a question for the next debater.`,
      task_id: `debate-r1-claude-${Date.now()}`,
      system_prompt: "You are debating programming languages. Argue for Rust. Keep it concise (2-3 sentences + 1 question).",
    });
    console.log("\n=== Round 1: Claude (Rust) ===");
    console.log(r1_claude.content?.substring(0, 300));
    expect(r1_claude.finish_reason).toBe("stop");
    expect(r1_claude.content).toBeTruthy();

    // Round 2: Codex가 Go를 옹호하며 Claude에 반론
    const relay_r1 = sanitize_relay(r1_claude.content);
    const r2_codex = await codex.agent.run({
      task: `Previous debater argued for Rust: "${relay_r1}". Now argue in favor of Go in 2-3 sentences. Address their question and end with a question for the next debater.`,
      task_id: `debate-r2-codex-${Date.now()}`,
      system_prompt: "You are debating programming languages. Argue for Go. Keep it concise (2-3 sentences + 1 question).",
    });
    console.log("\n=== Round 2: Codex (Go) ===");
    console.log(r2_codex.content?.substring(0, 300));
    expect(r2_codex.finish_reason).toBe("stop");
    expect(r2_codex.content).toBeTruthy();

    // Round 3: Gemini가 TypeScript를 옹호하며 정리
    const relay_r2 = sanitize_relay(r2_codex.content);
    const r3_gemini = await gemini.agent.run({
      task: `Two debaters argued: Rust advocate said "${relay_r1}" and Go advocate said "${relay_r2}". Now argue in favor of TypeScript in 2-3 sentences. Then write a 1-sentence verdict starting with "VERDICT:".`,
      task_id: `debate-r3-gemini-${Date.now()}`,
      system_prompt: "You are debating programming languages. Argue for TypeScript. End with a fair verdict line starting with 'VERDICT:'.",
    });
    console.log("\n=== Round 3: Gemini (TypeScript) ===");
    console.log(r3_gemini.content?.substring(0, 400));
    expect(r3_gemini.finish_reason).toBe("stop");
    expect(r3_gemini.content).toBeTruthy();
    // 최종 판결이 포함되어야 함
    expect(r3_gemini.content?.toUpperCase()).toContain("VERDICT");
  }, 240_000);

  it("3자 코드 리뷰: 생성 → 리뷰 → 개선", async () => {
    const claude = create_cli_agent("claude");
    const codex = create_cli_agent("codex");
    const gemini = create_cli_agent("gemini");
    handles.push(claude, codex, gemini);

    // Step 1: Claude가 간단한 함수 생성
    const step1 = await claude.agent.run({
      task: "Write a short JavaScript function called 'fibonacci' that returns the nth Fibonacci number. Output only the code, no explanation.",
      task_id: `review-step1-${Date.now()}`,
      system_prompt: "Output only code. No markdown fences, no explanation.",
    });
    console.log("\n=== Step 1: Claude writes code ===");
    console.log(step1.content?.substring(0, 300));
    expect(step1.finish_reason).toBe("stop");
    expect(step1.content).toContain("fibonacci");

    // Step 2: Codex가 코드 리뷰
    const relay_code = sanitize_relay(step1.content);
    const step2 = await codex.agent.run({
      task: `Review this code and list exactly 2 improvements (numbered 1. and 2.):\n\n${relay_code}`,
      task_id: `review-step2-${Date.now()}`,
      system_prompt: "You are a code reviewer. List exactly 2 numbered improvements. Be concise.",
    });
    console.log("\n=== Step 2: Codex reviews ===");
    console.log(step2.content?.substring(0, 300));
    expect(step2.finish_reason).toBe("stop");
    expect(step2.content).toMatch(/1\./);
    expect(step2.content).toMatch(/2\./);

    // Step 3: Gemini가 리뷰를 반영하여 개선된 코드 작성
    const relay_review = sanitize_relay(step2.content);
    const step3 = await gemini.agent.run({
      task: `Original code:\n${relay_code}\n\nReview feedback:\n${relay_review}\n\nRewrite the function applying both improvements. Output only the improved code.`,
      task_id: `review-step3-${Date.now()}`,
      system_prompt: "Output only code. Apply the review feedback to improve the function.",
    });
    console.log("\n=== Step 3: Gemini improves ===");
    console.log(step3.content?.substring(0, 400));
    expect(step3.finish_reason).toBe("stop");
    expect(step3.content).toContain("fibonacci");
  }, 240_000);
});
