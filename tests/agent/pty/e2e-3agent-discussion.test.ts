/**
 * 3자 토론 E2E 테스트 — 실제 Claude, Codex, Gemini CLI.
 *
 * 실제 CLI를 LocalPty로 spawn하여 ContainerCliAgent 경유 토론.
 * butler(claude) → impl(codex) → reviewer(gemini) 순차 토론 시나리오.
 *
 * 실행: npx vitest run tests/agent/pty/e2e-3agent-discussion.test.ts
 * 환경변수:
 *   E2E_SKIP=1 — CLI 미설치 환경에서 스킵
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import { CommPermissionGuard } from "@src/agent/pty/comm-permission.ts";
import { local_pty_factory } from "@src/agent/pty/local-pty.ts";
import type { CliAdapter } from "@src/agent/pty/types.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const SKIP = process.env.E2E_SKIP === "1";

type CliRole = { name: string; cli: string; adapter: CliAdapter };

function cli_available(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const ALL_ROLES: CliRole[] = [
  { name: "butler", cli: "claude", adapter: new ClaudeCliAdapter() },
  { name: "impl", cli: "codex", adapter: new CodexCliAdapter() },
  { name: "reviewer", cli: "gemini", adapter: new GeminiCliAdapter() },
];

const AVAILABLE_ROLES = ALL_ROLES.filter((r) => !SKIP && cli_available(r.cli));
const CAN_RUN = AVAILABLE_ROLES.length >= 2;

type AgentEntry = {
  agent: ContainerCliAgent;
  bus: AgentBus;
  adapter: CliAdapter;
};

type DiscussionStack = {
  agents: Map<string, AgentEntry>;
  shutdown: () => void;
};

/** 역할마다 독립 pool + bus + agent를 조립. 각 CLI 어댑터가 다르므로 별도 스택 필요. */
function create_discussion_stack(
  roles: CliRole[],
  guard?: CommPermissionGuard,
): DiscussionStack {
  const logger = create_noop_logger();
  const agents = new Map<string, AgentEntry>();

  for (const role of roles) {
    const pool = new ContainerPool({
      pty_factory: local_pty_factory,
      adapter: role.adapter,
      default_env: {},
      cwd: process.cwd(),
      max_idle_ms: 0,
      logger,
    });

    const bus = new AgentBus({
      pool,
      adapter: role.adapter,
      logger,
      permission_guard: guard,
    });

    const agent = new ContainerCliAgent({
      id: `e2e-${role.name}`,
      bus,
      adapter: role.adapter,
      logger,
      default_env: {},
    });

    agents.set(role.name, { agent, bus, adapter: role.adapter });
  }

  return {
    agents,
    shutdown: () => {
      for (const entry of agents.values()) entry.agent.stop();
    },
  };
}

describe.skipIf(!CAN_RUN)(`3-Agent Discussion E2E (${AVAILABLE_ROLES.map(r => r.cli).join(", ")})`, () => {
  let stack: DiscussionStack;

  afterEach(() => { stack?.shutdown(); });

  it("각 에이전트가 독립적으로 응답", async () => {
    stack = create_discussion_stack(AVAILABLE_ROLES);
    const results: Record<string, string> = {};

    for (const role of AVAILABLE_ROLES) {
      const entry = stack.agents.get(role.name)!;

      console.log(`\n=== [${role.name}] ${role.cli} spawn ===`);

      const result = await entry.agent.run({
        task: `Say exactly: I_AM_${role.name.toUpperCase()}`,
        task_id: `e2e-3a-${role.name}-${Date.now()}`,
        system_prompt: `You are ${role.name}. Respond with exactly what is asked, nothing more.`,
        hooks: { on_stream: (c: string) => process.stdout.write(c) },
      });

      console.log(`\n[${role.name}] finish: ${result.finish_reason}`);
      expect(result.finish_reason).toBe("stop");
      expect(result.content).toBeTruthy();
      results[role.name] = result.content!;
    }

    expect(Object.keys(results)).toHaveLength(AVAILABLE_ROLES.length);
  }, 180_000);

  it("순차 토론: 각 에이전트가 이전 의견을 읽고 답변", async () => {
    stack = create_discussion_stack(AVAILABLE_ROLES);

    const topic = "Should unit tests mock external dependencies or use real implementations?";
    let discussion = `Topic: ${topic}\n\n`;

    for (let i = 0; i < AVAILABLE_ROLES.length; i++) {
      const role = AVAILABLE_ROLES[i]!;
      const entry = stack.agents.get(role.name)!;

      const task = i === 0
        ? `Give a brief opinion (2-3 sentences) on: ${topic}`
        : `Read the discussion and add your opinion (2-3 sentences):\n\n${discussion}`;

      console.log(`\n=== [Round ${i + 1}] ${role.name} (${role.cli}) ===`);

      const result = await entry.agent.run({
        task,
        task_id: `e2e-discuss-${role.name}-${Date.now()}`,
        system_prompt: `You are ${role.name}, a software engineer. Be concise.`,
        hooks: { on_stream: (c: string) => process.stdout.write(c) },
      });

      console.log(`\n[${role.name}] finish: ${result.finish_reason}`);
      expect(result.finish_reason).toBe("stop");
      expect(result.content).toBeTruthy();

      discussion += `[${role.name}]: ${result.content}\n\n`;
    }

    // 모든 에이전트의 의견 포함
    for (const role of AVAILABLE_ROLES) {
      expect(discussion).toContain(`[${role.name}]`);
    }

    console.log("\n=== Final Discussion ===");
    console.log(discussion.substring(0, 1500));
  }, 300_000);

  it("토론 후 종합 요약", async () => {
    stack = create_discussion_stack(AVAILABLE_ROLES);

    // Round 1: 각자 의견
    const opinions: Record<string, string> = {};
    const question = "What is the single most important principle in software design?";

    for (const role of AVAILABLE_ROLES) {
      const entry = stack.agents.get(role.name)!;
      const result = await entry.agent.run({
        task: `Answer in one sentence: ${question}`,
        task_id: `e2e-opinion-${role.name}-${Date.now()}`,
        system_prompt: `You are ${role.name}. Be extremely concise — one sentence only.`,
        hooks: { on_stream: (c: string) => process.stdout.write(c) },
      });
      expect(result.finish_reason).toBe("stop");
      opinions[role.name] = result.content ?? "";
      console.log(`\n[${role.name}]: ${result.content?.substring(0, 200)}`);
    }

    // Round 2: 첫 번째 에이전트가 종합 요약
    const summarizer = AVAILABLE_ROLES[0]!;
    const entry = stack.agents.get(summarizer.name)!;

    const opinion_text = Object.entries(opinions)
      .map(([name, text]) => `- ${name}: ${text}`)
      .join("\n");

    const summary = await entry.agent.run({
      task: `Synthesize these opinions into one consensus statement:\n${opinion_text}`,
      task_id: `e2e-summary-${Date.now()}`,
      system_prompt: "Combine all opinions into one brief consensus. Be concise.",
      hooks: { on_stream: (c: string) => process.stdout.write(c) },
    });

    console.log(`\n\n=== Summary by ${summarizer.name} ===`);
    console.log(summary.content?.substring(0, 500));

    expect(summary.finish_reason).toBe("stop");
    expect(summary.content).toBeTruthy();
    expect(summary.content!.length).toBeGreaterThan(10);
  }, 300_000);
});
