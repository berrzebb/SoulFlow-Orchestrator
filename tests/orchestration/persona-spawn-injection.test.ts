/**
 * 역할별 Soul/Heart 주입 통합 테스트 (skills/roles 기반)
 *
 * 캡처 대상 3개 레이어:
 *   1. Controller(orchestrator LLM) system prompt  — soul/heart 주입 확인
 *   2. Executor(subagent) system prompt — soul/heart 주입 확인
 *   3. Bus 메시지                       — 채널 발화 직전 content
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.ts";
import { ContextBuilder } from "@src/agent/context.ts";

/* ── 캡처 타입 ────────────────────────────────────────── */

type CapturedProviderCall = {
  phase: "controller" | "executor";
  system_prompt: string;
  user_message: string;
  response_content: string;
};

type CapturedBusMessage = {
  direction: "inbound" | "outbound";
  content: string;
  sender_id: string;
  chat_id: string;
  channel: string;
  metadata?: Record<string, unknown>;
};

/* ── Capture Harness ──────────────────────────────────── */

function create_harness(opts?: {
  needs_executor?: boolean;
  executor_response?: string;
  final_answer?: string;
}) {
  const provider_calls: CapturedProviderCall[] = [];
  const bus_messages: CapturedBusMessage[] = [];
  let controller_call_count = 0;

  const needs_executor = opts?.needs_executor ?? false;
  const executor_response = opts?.executor_response ?? "작업이 완료되었습니다.";
  const final_answer = opts?.final_answer ?? executor_response;

  const providers = {
    get_orchestrator_provider_id: () => "orchestrator_llm",

    run_orchestrator: async (args: { messages: Array<{ role: string; content: string }>; [k: string]: unknown }) => {
      controller_call_count++;
      const sys = args.messages.find((m) => m.role === "system");
      const usr = args.messages.find((m) => m.role === "user");

      const is_first = controller_call_count === 1;
      const should_dispatch = needs_executor && is_first;

      const response_content = JSON.stringify(
        should_dispatch
          ? { done: false, executor_prompt: "주어진 작업을 수행하세요.", final_answer: "", reason: "executor_needed", handoffs: [] }
          : { done: true, executor_prompt: "", final_answer, reason: "completed", handoffs: [] },
      );

      provider_calls.push({
        phase: "controller",
        system_prompt: sys?.content || "",
        user_message: usr?.content || "",
        response_content,
      });
      return { content: response_content };
    },

    run_headless: async (args: { messages: Array<{ role: string; content: string }>; [k: string]: unknown }) => {
      const sys = args.messages.find((m) => m.role === "system");
      const usr = args.messages.find((m) => m.role === "user");

      provider_calls.push({
        phase: "executor",
        system_prompt: sys?.content || "",
        user_message: usr?.content || "",
        response_content: executor_response,
      });
      return { content: executor_response, has_tool_calls: false, tool_calls: [] };
    },
  };

  const bus = {
    publish_inbound: async (msg: CapturedBusMessage & { id: string; provider: string; at: string }) => {
      bus_messages.push({ direction: "inbound", content: msg.content, sender_id: msg.sender_id, chat_id: msg.chat_id, channel: msg.channel, metadata: msg.metadata as Record<string, unknown> });
    },
    publish_outbound: async (msg: CapturedBusMessage & { id: string; provider: string; at: string }) => {
      bus_messages.push({ direction: "outbound", content: msg.content, sender_id: msg.sender_id, chat_id: msg.chat_id, channel: msg.channel, metadata: msg.metadata as Record<string, unknown> });
    },
  };

  return { providers, bus, provider_calls, bus_messages };
}

/* ── 헬퍼 ─────────────────────────────────────────────── */

function extract_prompt_field(prompt: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  return re.exec(prompt)?.[1]?.trim() || "";
}

function write_role_skill(workspace: string, role: string, opts: { soul?: string; heart?: string; body?: string }): Promise<void> {
  const dir = join(workspace, "src", "skills", "roles", role);
  const soul_line = opts.soul ? `  soul: ${opts.soul}` : "";
  const heart_line = opts.heart ? `  heart: ${opts.heart}` : "";
  const content = [
    "---",
    `name: role:${role}`,
    `description: ${role} 역할.`,
    "metadata:",
    "  type: role",
    `  role: ${role}`,
    soul_line,
    heart_line,
    "---",
    "",
    opts.body || `# ${role}`,
  ].filter((l) => l !== "").join("\n");
  return mkdir(dir, { recursive: true }).then(() => writeFile(join(dir, "SKILL.md"), content));
}

/* ── 테스트 ───────────────────────────────────────────── */

describe("persona spawn injection — skills/roles 기반", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "persona-inject-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /* ── 1. Controller 프롬프트에 soul/heart 주입 ── */

  it("controller 프롬프트에 역할의 soul/heart가 주입된다", async () => {
    await write_role_skill(workspace, "lead", {
      soul: "전문가 집단의 PM. 결단력 있고 전략적 판단이 빠르다.",
      heart: "팀원에게는 명확하고 간결한 지시. 배경과 이유를 함께 전달한다.",
      body: "# Lead\n\n## Mission\n작업을 분석하고 위임한다.",
    });

    const context = new ContextBuilder(workspace);
    const role_skill = context.skills_loader.get_role_skill("lead");
    expect(role_skill).not.toBeNull();

    const { providers, bus, provider_calls } = create_harness({ final_answer: "위임 완료." });

    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });
    const result = await registry.spawn({
      task: "프로젝트 구조 분석",
      role: "lead",
      soul: role_skill!.soul || undefined,
      heart: role_skill!.heart || undefined,
      origin_channel: "slack",
      origin_chat_id: "C001",
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    expect(provider_calls.length).toBeGreaterThan(0);
    const controller = provider_calls.find((c) => c.phase === "controller")!;

    expect(extract_prompt_field(controller.system_prompt, "soul")).toBe("전문가 집단의 PM. 결단력 있고 전략적 판단이 빠르다.");
    expect(extract_prompt_field(controller.system_prompt, "heart")).toBe("팀원에게는 명확하고 간결한 지시. 배경과 이유를 함께 전달한다.");

    expect(controller.system_prompt).not.toContain("Calm, pragmatic, collaborative teammate");
    expect(controller.system_prompt).not.toContain("Prioritize correctness, safety, and completion");
  });

  /* ── 2. Executor 프롬프트에도 동일한 soul/heart 주입 ── */

  it("executor 프롬프트에도 역할의 soul/heart가 전달된다", async () => {
    await write_role_skill(workspace, "implementer", {
      soul: "묵묵하고 정밀한 풀스택 엔지니어. 코드로 말한다.",
      heart: "말보다 결과물. 변경 파일 목록과 자체 검증 결과로 보고한다.",
      body: "# Implementer\n\n## Mission\n명세서 기반으로 코드를 구현한다.",
    });

    const context = new ContextBuilder(workspace);
    const role_skill = context.skills_loader.get_role_skill("implementer");

    const { providers, bus, provider_calls } = create_harness({
      needs_executor: true,
      executor_response: "src/main.ts 수정 완료. cargo check 통과.",
    });

    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });
    const result = await registry.spawn({
      task: "login API 엔드포인트 추가",
      role: "implementer",
      soul: role_skill!.soul || undefined,
      heart: role_skill!.heart || undefined,
      origin_channel: "slack",
      origin_chat_id: "C002",
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    const executor = provider_calls.find((c) => c.phase === "executor");
    expect(executor).toBeDefined();
    expect(extract_prompt_field(executor!.system_prompt, "soul")).toBe("묵묵하고 정밀한 풀스택 엔지니어. 코드로 말한다.");
    expect(extract_prompt_field(executor!.system_prompt, "heart")).toBe("말보다 결과물. 변경 파일 목록과 자체 검증 결과로 보고한다.");
  });

  /* ── 3. 명시적 soul/heart가 role 기반 값보다 우선 ── */

  it("spawn 시 명시적 soul/heart가 role 기반 값보다 우선한다", async () => {
    await write_role_skill(workspace, "lead", {
      soul: "파일에 정의된 soul.",
      heart: "파일에 정의된 heart.",
    });

    const context = new ContextBuilder(workspace);

    const { providers, bus, provider_calls } = create_harness();
    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });

    const result = await registry.spawn({
      task: "테스트",
      role: "lead",
      soul: "명시적으로 지정한 soul.",
      heart: "명시적으로 지정한 heart.",
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    const prompt = provider_calls[0].system_prompt;
    // 서브에이전트 헤더의 soul/heart 필드가 명시적 값으로 오버라이드됨
    expect(extract_prompt_field(prompt, "soul")).toBe("명시적으로 지정한 soul.");
    expect(extract_prompt_field(prompt, "heart")).toBe("명시적으로 지정한 heart.");
  });

  /* ── 4. Soul/Heart 없는 role → 기본 fallback 사용 ── */

  it("soul/heart가 없는 role은 기본 fallback을 사용한다", async () => {
    await write_role_skill(workspace, "worker", {
      body: "# Worker\n\n## Mission\n일반 작업 수행.",
    });

    const context = new ContextBuilder(workspace);
    const role_skill = context.skills_loader.get_role_skill("worker");
    expect(role_skill).not.toBeNull();
    expect(role_skill!.soul).toBeNull();

    const { providers, bus, provider_calls } = create_harness();
    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });

    const result = await registry.spawn({
      task: "작업",
      role: "worker",
      soul: role_skill!.soul || undefined,
      heart: role_skill!.heart || undefined,
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    const prompt = provider_calls[0].system_prompt;
    expect(extract_prompt_field(prompt, "soul")).toBe("Calm, pragmatic, collaborative teammate.");
    expect(extract_prompt_field(prompt, "heart")).toBe("Prioritize correctness, safety, and completion.");
  });

  /* ── 5. Bus 메시지 — 채널 발화 직전 content 검증 ── */

  it("완료 시 bus inbound 메시지에 결과가 포함된다", async () => {
    await write_role_skill(workspace, "lead", {
      soul: "PM 역할.",
      heart: "간결한 보고.",
    });

    const context = new ContextBuilder(workspace);
    const role_skill = context.skills_loader.get_role_skill("lead")!;

    const { providers, bus, bus_messages } = create_harness({
      final_answer: "프로젝트 구조 분석 완료. 3개 모듈로 분리 제안합니다.",
    });

    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });
    const result = await registry.spawn({
      task: "프로젝트 구조 분석",
      role: "lead",
      soul: role_skill.soul || undefined,
      heart: role_skill.heart || undefined,
      origin_channel: "slack",
      origin_chat_id: "C003",
      announce: true,
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    const result_msg = bus_messages.find(
      (m) => m.direction === "outbound" && m.metadata?.kind === "subagent_result",
    );
    expect(result_msg).toBeDefined();
    expect(result_msg!.content).toContain("프로젝트 구조 분석 완료");
    expect(result_msg!.content).toContain("3개 모듈로 분리 제안합니다");
    expect(result_msg!.channel).toBe("slack");
    expect(result_msg!.chat_id).toBe("C003");
    expect(result_msg!.sender_id).toContain("subagent:");
  });

  /* ── 6. Executor 응답 bus 전달 end-to-end ── */

  it("executor 응답이 bus result 메시지에 반영된다", async () => {
    await write_role_skill(workspace, "implementer", {
      soul: "코드로 말하는 엔지니어.",
      heart: "결과물로 보고한다.",
      body: "# Implementer\n\n## Mission\n구현.",
    });

    const context = new ContextBuilder(workspace);
    const role_skill = context.skills_loader.get_role_skill("implementer")!;

    const executor_output = [
      "변경 파일:",
      "- src/auth/login.ts (신규)",
      "- src/routes/index.ts (수정)",
      "자체 검증: tsc --noEmit 통과.",
    ].join("\n");

    const { providers, bus, provider_calls, bus_messages } = create_harness({
      needs_executor: true,
      executor_response: executor_output,
      final_answer: executor_output,
    });

    const registry = new SubagentRegistry({ workspace, providers: providers as any, bus: bus as any, context_builder: context });
    const result = await registry.spawn({
      task: "login API 추가",
      role: "implementer",
      soul: role_skill.soul || undefined,
      heart: role_skill.heart || undefined,
      origin_channel: "telegram",
      origin_chat_id: "T001",
    });
    await registry.wait_for_completion(result.subagent_id, 5000);

    const controller = provider_calls.find((c) => c.phase === "controller")!;
    expect(extract_prompt_field(controller.system_prompt, "role")).toBe("implementer");
    expect(extract_prompt_field(controller.system_prompt, "soul")).toBe("코드로 말하는 엔지니어.");

    const executor = provider_calls.find((c) => c.phase === "executor")!;
    expect(extract_prompt_field(executor.system_prompt, "soul")).toBe("코드로 말하는 엔지니어.");
    expect(extract_prompt_field(executor.system_prompt, "heart")).toBe("결과물로 보고한다.");

    const bus_result = bus_messages.find(
      (m) => m.direction === "outbound" && m.metadata?.kind === "subagent_result",
    );
    expect(bus_result).toBeDefined();
    expect(bus_result!.content).toContain("src/auth/login.ts (신규)");
    expect(bus_result!.content).toContain("tsc --noEmit 통과");
    expect(bus_result!.channel).toBe("telegram");
  });

  /* ── 7. 복수 역할 동시 spawn — 각각 고유 persona 적용 ── */

  it("서로 다른 역할을 동시에 spawn하면 각각 고유 persona가 적용된다", async () => {
    await write_role_skill(workspace, "lead", { soul: "PM 역할의 리더.", heart: "전략적 판단." });
    await write_role_skill(workspace, "validator", { soul: "품질 게이트. 통과 아니면 실패.", heart: "원문 그대로 전달." });

    const context = new ContextBuilder(workspace);

    const lead_skill = context.skills_loader.get_role_skill("lead")!;
    const validator_skill = context.skills_loader.get_role_skill("validator")!;

    const h1 = create_harness({ final_answer: "분석 완료" });
    const r1 = new SubagentRegistry({ workspace, providers: h1.providers as any, bus: h1.bus as any, context_builder: context });
    const s1 = await r1.spawn({
      task: "구조 분석", role: "lead",
      soul: lead_skill.soul || undefined,
      heart: lead_skill.heart || undefined,
    });

    const h2 = create_harness({ final_answer: "테스트 통과" });
    const r2 = new SubagentRegistry({ workspace, providers: h2.providers as any, bus: h2.bus as any, context_builder: context });
    const s2 = await r2.spawn({
      task: "CI 검증", role: "validator",
      soul: validator_skill.soul || undefined,
      heart: validator_skill.heart || undefined,
    });

    await Promise.all([
      r1.wait_for_completion(s1.subagent_id, 5000),
      r2.wait_for_completion(s2.subagent_id, 5000),
    ]);

    expect(extract_prompt_field(h1.provider_calls[0].system_prompt, "soul")).toBe("PM 역할의 리더.");
    expect(extract_prompt_field(h2.provider_calls[0].system_prompt, "soul")).toBe("품질 게이트. 통과 아니면 실패.");
  });

  /* ── 8. 시스템 프롬프트에 body만 포함, soul/heart 미노출 ── */

  it("build_role_system_prompt에 body 포함, soul/heart는 Persona 섹션에만 노출", async () => {
    await write_role_skill(workspace, "debugger", {
      soul: "집요한 원인 추적 전문가.",
      heart: "증상 → 가설 → 검증 → 원인 흐름.",
      body: "# Debugger\n\n## Mission\n에러의 근본 원인을 추적한다.\n\n## Constraints\n3파일 초과 수정 금지.",
    });

    const context = new ContextBuilder(workspace);
    const system_prompt = await context.build_role_system_prompt("debugger");

    // body 포함
    expect(system_prompt).toContain("에러의 근본 원인을 추적한다");
    expect(system_prompt).toContain("3파일 초과 수정 금지");

    // Persona 섹션에 soul/heart
    expect(system_prompt).toContain("Soul: 집요한 원인 추적 전문가.");
    expect(system_prompt).toContain("Heart: 증상 → 가설 → 검증 → 원인 흐름.");
  });
});
