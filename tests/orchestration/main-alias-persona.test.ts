/**
 * 메인 채널 alias -> system prompt persona 적용 검증.
 *
 * P0-1 회귀 테스트: alias에 대응하는 role skill이 있으면
 * build_role_system_prompt()가 사용되어 persona가 시스템 프롬프트에 포함되어야 한다.
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextBuilder } from "@src/agent/context.ts";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "alias-persona-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function write_role_skill(role: string, opts: { soul?: string; heart?: string; body?: string }): Promise<void> {
  const dir = join(workspace, "src", "skills", "roles", role);
  const lines = [
    "---",
    `name: role:${role}`,
    `description: ${role} role.`,
    "metadata:",
    "  type: role",
    `  role: ${role}`,
    opts.soul ? `  soul: ${opts.soul}` : "",
    opts.heart ? `  heart: ${opts.heart}` : "",
    "---",
    "",
    opts.body || `# ${role}`,
  ].filter(Boolean);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), lines.join("\n"));
}

/**
 * OrchestrationService._build_system_prompt()와 동일한 분기 로직 검증.
 * alias가 있고 role skill이 매칭되면 build_role_system_prompt 경로,
 * 없으면 build_system_prompt + concierge hint 경로를 따르는지 확인.
 */
async function simulate_orchestration_build_prompt(
  ctx: InstanceType<typeof ContextBuilder>,
  skill_names: string[],
  provider: string,
  chat_id: string,
  alias?: string,
): Promise<string> {
  const role = alias || "";
  const role_skill = role ? ctx.skills_loader.get_role_skill(role) : null;
  if (role_skill) {
    return ctx.build_role_system_prompt(role, skill_names, undefined, { channel: provider, chat_id });
  }
  const system = await ctx.build_system_prompt(skill_names, undefined, { channel: provider, chat_id });
  const concierge_skill = ctx.skills_loader.get_role_skill("concierge");
  const active_role_hint = concierge_skill?.heart
    ? `\n\n# Active Role: concierge\n${concierge_skill.heart}`
    : "";
  return `${system}${active_role_hint}`;
}

describe("메인 채널 alias -> persona 적용", () => {
  it("alias에 대응하는 role skill이 있으면 build_role_system_prompt에 persona가 포함된다", async () => {
    await write_role_skill("lead", {
      soul: "전략적 의사결정 전문가",
      heart: "명확하고 간결하게 지시한다",
      body: "# Lead\n프로젝트를 이끈다.",
    });

    const ctx = new ContextBuilder(workspace);
    const role_skill = ctx.skills_loader.get_role_skill("lead");
    expect(role_skill).not.toBeNull();
    expect(role_skill!.soul).toContain("전략적");
    expect(role_skill!.heart).toContain("명확");

    const prompt = await ctx.build_role_system_prompt("lead", []);
    expect(prompt).toContain("Role Context: lead");
    expect(prompt).toContain("전략적 의사결정 전문가");
    expect(prompt).toContain("명확하고 간결하게 지시한다");
  });

  it("alias에 대응하는 role skill이 없으면 build_role_system_prompt는 base prompt만 반환한다", async () => {
    const ctx = new ContextBuilder(workspace);
    const role_skill = ctx.skills_loader.get_role_skill("nonexistent");
    expect(role_skill).toBeNull();

    const prompt = await ctx.build_role_system_prompt("nonexistent", []);
    expect(prompt).not.toContain("Role Context");
    expect(prompt).not.toContain("Persona");
  });

  it("concierge role이 있어도 alias가 다른 role이면 해당 role persona가 적용된다", async () => {
    await write_role_skill("concierge", {
      heart: "친절한 안내원",
    });
    await write_role_skill("reviewer", {
      soul: "꼼꼼한 코드 리뷰어",
      heart: "코드 품질에 집중한다",
      body: "# Reviewer\n코드를 리뷰한다.",
    });

    const ctx = new ContextBuilder(workspace);

    // reviewer alias로 조회 시 reviewer persona 적용
    const reviewer_prompt = await ctx.build_role_system_prompt("reviewer", []);
    expect(reviewer_prompt).toContain("Role Context: reviewer");
    expect(reviewer_prompt).toContain("꼼꼼한 코드 리뷰어");
    expect(reviewer_prompt).not.toContain("친절한 안내원");

    // concierge alias로 조회 시 concierge persona 적용
    const concierge_prompt = await ctx.build_role_system_prompt("concierge", []);
    expect(concierge_prompt).toContain("친절한 안내원");
  });
});

describe("build_messages로 provider에 전달되는 payload 검증", () => {
  it("role alias가 있으면 provider에 전달되는 system message에 persona가 포함된다", async () => {
    await write_role_skill("developer", {
      soul: "풀스택 개발자",
      heart: "코드 품질을 최우선으로 한다",
      body: "# Developer\n소프트웨어를 개발한다.",
    });

    const ctx = new ContextBuilder(workspace);
    // build_role_system_prompt로 system prompt 생성 후 build_messages와 같은 구조로 조립
    const system_prompt = await simulate_orchestration_build_prompt(ctx, [], "slack", "C123", "developer");
    const messages = [
      { role: "system" as const, content: system_prompt },
      { role: "user" as const, content: "코드 리뷰해줘" },
    ];

    // provider에 전달되는 messages[0].content에 persona가 포함되어야 함
    const system_content = messages[0].content;
    expect(system_content).toContain("Role Context: developer");
    expect(system_content).toContain("풀스택 개발자");
    expect(system_content).toContain("코드 품질을 최우선으로 한다");
    // concierge hint가 포함되지 않아야 함
    expect(system_content).not.toContain("Active Role: concierge");
  });

  it("alias 없이 build_messages 호출 시 session context가 system prompt에 포함된다", async () => {
    const ctx = new ContextBuilder(workspace);
    const messages = await ctx.build_messages([], "테스트 메시지", [], null, "telegram", "chat_42");

    const system = messages.find((m) => m.role === "system");
    expect(system).toBeDefined();
    const content = String(system!.content || "");
    expect(content).toContain("Channel: telegram");
    expect(content).toContain("Chat ID: chat_42");
  });
});

describe("OrchestrationService._build_system_prompt 분기 로직 E2E", () => {
  it("alias가 있고 role skill이 매칭되면 role persona가 system prompt에 포함된다", async () => {
    await write_role_skill("analyst", {
      soul: "데이터 분석 전문가",
      heart: "수치에 기반한 판단을 내린다",
      body: "# Analyst\n데이터를 분석하고 인사이트를 제공한다.",
    });

    const ctx = new ContextBuilder(workspace);
    const prompt = await simulate_orchestration_build_prompt(ctx, [], "slack", "C123", "analyst");

    expect(prompt).toContain("Role Context: analyst");
    expect(prompt).toContain("데이터 분석 전문가");
    expect(prompt).toContain("수치에 기반한 판단을 내린다");
    // concierge hint가 포함되지 않아야 함
    expect(prompt).not.toContain("Active Role: concierge");
  });

  it("alias가 없으면 base prompt + concierge hint가 적용된다", async () => {
    await write_role_skill("concierge", {
      heart: "친절한 안내원",
    });

    const ctx = new ContextBuilder(workspace);
    const prompt = await simulate_orchestration_build_prompt(ctx, [], "slack", "C123");

    expect(prompt).not.toContain("Role Context");
    expect(prompt).toContain("Active Role: concierge");
    expect(prompt).toContain("친절한 안내원");
  });

  it("alias가 있지만 매칭되는 role skill이 없으면 concierge fallback", async () => {
    await write_role_skill("concierge", {
      heart: "친절한 안내원",
    });

    const ctx = new ContextBuilder(workspace);
    const prompt = await simulate_orchestration_build_prompt(ctx, [], "telegram", "chat_1", "unknown_role");

    expect(prompt).not.toContain("Role Context: unknown_role");
    expect(prompt).toContain("Active Role: concierge");
    expect(prompt).toContain("친절한 안내원");
  });

  it("concierge skill도 없으면 base prompt만 반환", async () => {
    const ctx = new ContextBuilder(workspace);
    const prompt = await simulate_orchestration_build_prompt(ctx, [], "slack", "C999", "no_role");

    expect(prompt).not.toContain("Role Context");
    expect(prompt).not.toContain("Active Role: concierge");
  });
});
