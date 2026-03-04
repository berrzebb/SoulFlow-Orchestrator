/**
 * PTY → 실제 CLI → NDJSON 통신 E2E 테스트.
 *
 * 프로젝트 설정(provider store, config)과 무관하게 독립 실행.
 * 컨테이너 내부에서만 실행 가능 (CLI 바이너리 필요).
 *
 * 실행: npx vitest run tests/agent/pty/e2e-real-cli.test.ts
 * 환경변수:
 *   E2E_CLI=claude|codex|gemini — 테스트할 CLI (기본: claude)
 *   E2E_SKIP=1 — 실제 CLI 미설치 환경에서 스킵
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import type { PtyFactory, CliAdapter } from "@src/agent/pty/types.ts";
import type { AgentEvent } from "@src/agent/agent.types.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const CLI_TYPE = (process.env.E2E_CLI || "claude") as "claude" | "codex" | "gemini";
const SKIP = process.env.E2E_SKIP === "1";

function cli_available(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CLI_CMD = CLI_TYPE === "codex" ? "codex" : CLI_TYPE === "gemini" ? "gemini" : "claude";
const IS_AVAILABLE = !SKIP && cli_available(CLI_CMD);

/** 실제 CLI를 PTY로 스폰하는 팩토리. */
const real_pty_factory: PtyFactory = (file, args, options) => {
  return new LocalPty(file, args, options);
};

function create_real_agent(): { agent: ContainerCliAgent; adapter: CliAdapter } {
  const adapter = CLI_TYPE === "codex" ? new CodexCliAdapter()
    : CLI_TYPE === "gemini" ? new GeminiCliAdapter()
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
    id: `e2e-${CLI_TYPE}`,
    bus,
    adapter,
    logger,
    default_env: {},
  });
  return { agent, adapter };
}

describe.skipIf(!IS_AVAILABLE)(`PTY E2E: 실제 ${CLI_CMD} CLI`, () => {
  let agent: ContainerCliAgent;
  afterEach(() => { agent?.stop(); });

  it("실제 CLI를 PTY로 스폰하고 NDJSON 응답을 수신한다", async () => {
    const { agent: a } = create_real_agent();
    agent = a;

    const events: AgentEvent[] = [];
    const result = await agent.run({
      task: "Say exactly: HELLO_PTY_E2E",
      task_id: `e2e-${CLI_TYPE}-${Date.now()}`,
      system_prompt: "You are a test agent. Respond with exactly what is asked, nothing more.",
      hooks: {
        on_event: (e) => events.push(e),
        on_stream: (chunk) => process.stdout.write(chunk),
      },
    });

    console.log("\n=== AgentRunResult ===");
    console.log("finish_reason:", result.finish_reason);
    console.log("content:", result.content?.substring(0, 200));
    console.log("usage:", JSON.stringify(result.usage));
    console.log("session:", result.session?.session_id?.substring(0, 20));
    console.log("tool_calls:", result.tool_calls_count);
    console.log("events:", events.map(e => e.type).join(", "));

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBeTruthy();
    expect(result.content).toContain("HELLO_PTY_E2E");

    const event_types = events.map(e => e.type);
    expect(event_types).toContain("init");
    expect(event_types).toContain("complete");
  }, 60_000);

  it("system_prompt가 실제 CLI에 전달된다", async () => {
    const { agent: a } = create_real_agent();
    agent = a;

    const result = await agent.run({
      task: "What is your assigned codename?",
      task_id: `e2e-sys-${Date.now()}`,
      system_prompt: "Your codename is PHOENIX_AGENT. Always mention your codename when asked.",
    });

    console.log("\n=== System Prompt Test ===");
    console.log("content:", result.content?.substring(0, 300));

    expect(result.finish_reason).toBe("stop");
    expect(result.content?.toUpperCase()).toContain("PHOENIX");
  }, 60_000);

  it("send_input으로 followup 대화를 주고받는다", async () => {
    const { agent: a } = create_real_agent();
    agent = a;

    let send_fn: ((text: string) => void) | null = null;
    const result = await agent.run({
      task: "Remember the number 42. Say OK.",
      task_id: `e2e-followup-${Date.now()}`,
      register_send_input: (fn) => { send_fn = fn; },
    });

    console.log("\n=== Followup Test (turn 1) ===");
    console.log("content:", result.content?.substring(0, 200));

    expect(result.finish_reason).toBe("stop");
    expect(send_fn).not.toBeNull();
  }, 60_000);
});
