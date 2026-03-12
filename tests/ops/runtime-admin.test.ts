/**
 * RuntimeAdminTool — 종합 커버리지:
 * - action 라우팅, skill_upsert/list, tool_install_shell/uninstall/list
 * - mcp 서버 관리, validate_params
 * - parse_skill_name 분기 (프론트매터 없음, name 없음, name 있음)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeAdminTool } from "@src/agent/tools/runtime-admin.ts";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";

function parse<T = Record<string, unknown>>(text: string): T {
  return JSON.parse(String(text || "{}")) as T;
}

// ══════════════════════════════════════════════════════════
// 종합 액션 테스트
// ══════════════════════════════════════════════════════════

describe("RuntimeAdminTool — 종합 액션", () => {
  let workspace: string;
  let tool: RuntimeAdminTool;
  let refresh_count = 0;
  let skill_refresh_count = 0;
  const registered_tools: string[] = ["reserved_tool"];

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "runtime-admin-cov-"));
    const installer = new ToolInstallerService(workspace);
    tool = new RuntimeAdminTool({
      workspace,
      installer,
      refresh_dynamic_tools: () => { refresh_count++; return refresh_count; },
      refresh_skills: () => { skill_refresh_count++; },
      list_registered_tool_names: () => registered_tools,
    });
  });

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  describe("action 라우팅", () => {
    it("action 없으면 Error 반환", async () => {
      const r = await tool.execute({ action: "" });
      expect(r).toContain("Error");
    });

    it("미지원 action → Error 반환", async () => {
      const r = await tool.execute({ action: "unknown_action" });
      expect(r).toContain("Error");
      expect(r).toContain("unknown_action");
    });
  });

  describe("skill_upsert", () => {
    it("스킬 생성 후 JSON ok:true 반환", async () => {
      const r = parse(await tool.execute({
        action: "skill_upsert",
        skill_name: "my-skill",
        skill_body: "This skill does things.",
        skill_summary: "My custom skill",
      }));
      expect(r.ok).toBe(true);
      expect(r.action).toBe("skill_upsert");
      expect(skill_refresh_count).toBeGreaterThan(0);
    });

    it("skill_name 없으면 Error 반환", async () => {
      const r = await tool.execute({ action: "skill_upsert", skill_body: "body" });
      expect(r).toContain("Error");
      expect(r).toContain("skill_name");
    });

    it("skill_body 없으면 Error 반환", async () => {
      const r = await tool.execute({ action: "skill_upsert", skill_name: "test" });
      expect(r).toContain("Error");
      expect(r).toContain("skill_body");
    });

    it("skill_always=true로 생성", async () => {
      const r = parse(await tool.execute({
        action: "skill_upsert",
        skill_name: "auto-skill",
        skill_body: "Auto skill body.",
        skill_always: true,
      }));
      expect(r.ok).toBe(true);
      const skill = r.skill as Record<string, unknown>;
      expect(skill.always).toBe(true);
    });

    it("skill_name이 특수문자 포함되면 정규화", async () => {
      const r = parse(await tool.execute({
        action: "skill_upsert",
        skill_name: "My Skill With Spaces!",
        skill_body: "body",
      }));
      expect(r.ok).toBe(true);
    });
  });

  describe("skill_list", () => {
    it("생성된 스킬 목록 반환", async () => {
      await tool.execute({
        action: "skill_upsert",
        skill_name: "listed-skill",
        skill_body: "body",
      });
      const r = await tool.execute({ action: "skill_list" });
      const list = parse<unknown[]>(r) as Array<Record<string, unknown>>;
      expect(Array.isArray(list)).toBe(true);
      const found = list.find((s) => String(s.name || "").includes("listed-skill"));
      expect(found).toBeTruthy();
    });

    it("빈 workspace에서 skill_list → 빈 배열", async () => {
      const empty_ws = await mkdtemp(join(tmpdir(), "empty-ws-"));
      const installer2 = new ToolInstallerService(empty_ws);
      const tool2 = new RuntimeAdminTool({ workspace: empty_ws, installer: installer2 });
      const r = await tool2.execute({ action: "skill_list" });
      const list = parse<unknown[]>(r);
      expect(list).toHaveLength(0);
      await rm(empty_ws, { recursive: true, force: true });
    });
  });

  describe("tool_install_shell", () => {
    it("shell 도구 설치 성공", async () => {
      const r = parse(await tool.execute({
        action: "tool_install_shell",
        tool_name: "my_shell_tool",
        tool_description: "A test shell tool",
        tool_command_template: "echo {{message}}",
      }));
      expect(r.ok).toBe(true);
      expect(r.action).toBe("tool_install_shell");
      expect(refresh_count).toBeGreaterThan(0);
    });

    it("tool_name 없으면 Error", async () => {
      const r = await tool.execute({
        action: "tool_install_shell",
        tool_description: "desc",
        tool_command_template: "echo",
      });
      expect(r).toContain("Error");
      expect(r).toContain("tool_name");
    });

    it("tool_description 없으면 Error", async () => {
      const r = await tool.execute({
        action: "tool_install_shell",
        tool_name: "valid_name",
        tool_command_template: "echo",
      });
      expect(r).toContain("Error");
      expect(r).toContain("tool_description");
    });

    it("tool_command_template 없으면 Error", async () => {
      const r = await tool.execute({
        action: "tool_install_shell",
        tool_name: "valid_name",
        tool_description: "desc",
      });
      expect(r).toContain("Error");
      expect(r).toContain("tool_command_template");
    });

    it("유효하지 않은 tool_name (특수문자) → Error", async () => {
      const r = await tool.execute({
        action: "tool_install_shell",
        tool_name: "invalid name!",
        tool_description: "desc",
        tool_command_template: "echo",
      });
      expect(r).toContain("Error");
      expect(r).toContain("invalid tool_name");
    });

    it("예약된 tool_name → Error", async () => {
      const r = await tool.execute({
        action: "tool_install_shell",
        tool_name: "reserved_tool",
        tool_description: "desc",
        tool_command_template: "echo",
      });
      expect(r).toContain("Error");
      expect(r).toContain("reserved");
    });

    it("tool_parameters 포함하여 설치", async () => {
      const r = parse(await tool.execute({
        action: "tool_install_shell",
        tool_name: "parameterized_tool",
        tool_description: "Tool with params",
        tool_command_template: "echo {{msg}}",
        tool_parameters: { properties: { msg: { type: "string" } }, required: ["msg"] },
        tool_working_dir: workspace,
        tool_overwrite: true,
        tool_requires_approval: true,
      }));
      expect(r.ok).toBe(true);
    });
  });

  describe("tool_uninstall", () => {
    it("설치된 도구 삭제", async () => {
      await tool.execute({
        action: "tool_install_shell",
        tool_name: "to_uninstall",
        tool_description: "Will be removed",
        tool_command_template: "echo bye",
      });
      const r = parse(await tool.execute({ action: "tool_uninstall", tool_name: "to_uninstall" }));
      expect(r.action).toBe("tool_uninstall");
    });

    it("tool_name 없으면 Error", async () => {
      const r = await tool.execute({ action: "tool_uninstall" });
      expect(r).toContain("Error");
    });

    it("없는 도구 삭제 → ok:false", async () => {
      const r = parse(await tool.execute({ action: "tool_uninstall", tool_name: "nonexistent_xyz" }));
      expect(r.ok).toBe(false);
    });
  });

  describe("tool_list", () => {
    it("설치된 도구 목록 반환", async () => {
      const r = await tool.execute({ action: "tool_list" });
      const list = parse<unknown[]>(r);
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe("mcp 서버 관리", () => {
    it("mcp_upsert_server: 유효하지 않은 server name → Error", async () => {
      const r = await tool.execute({ action: "mcp_upsert_server", mcp_server_name: "invalid name!" });
      expect(r).toContain("Error");
      expect(r).toContain("invalid mcp_server_name");
    });

    it("mcp_upsert_server: command와 url 모두 없으면 Error", async () => {
      const r = await tool.execute({ action: "mcp_upsert_server", mcp_server_name: "valid-server" });
      expect(r).toContain("Error");
      expect(r).toContain("mcp_command or mcp_url");
    });

    it("mcp_upsert_server: command와 url 동시 사용 → Error", async () => {
      const r = await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "dual-server",
        mcp_command: "npx",
        mcp_url: "http://localhost:3000",
      });
      expect(r).toContain("Error");
      expect(r).toContain("either");
    });

    it("mcp_upsert_server: url + mcp_args → Error", async () => {
      const r = await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "url-server",
        mcp_url: "http://localhost:3000",
        mcp_args: ["--port", "3000"],
      });
      expect(r).toContain("Error");
      expect(r).toContain("mcp_args");
    });

    it("mcp_upsert_server: url + mcp_cwd → Error", async () => {
      const r = await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "url-server2",
        mcp_url: "http://localhost:3000",
        mcp_cwd: "/some/path",
      });
      expect(r).toContain("Error");
      expect(r).toContain("mcp_cwd");
    });

    it("mcp_upsert_server: url + mcp_env → Error", async () => {
      const r = await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "url-server3",
        mcp_url: "http://localhost:3000",
        mcp_env: { KEY: "VALUE" },
      });
      expect(r).toContain("Error");
      expect(r).toContain("mcp_env");
    });

    it("mcp_upsert_server: url 서버 정상 등록", async () => {
      const r = parse(await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "url-only-server",
        mcp_url: "http://localhost:9999",
      }));
      expect(r.ok).toBe(true);
    });

    it("mcp_upsert_server: command + startup_timeout_sec 설정", async () => {
      const r = parse(await tool.execute({
        action: "mcp_upsert_server",
        mcp_server_name: "timeout-server",
        mcp_command: "node",
        mcp_args: ["server.js"],
        mcp_startup_timeout_sec: 30,
      }));
      expect(r.ok).toBe(true);
    });

    it("mcp_remove_server: 유효하지 않은 server name → Error", async () => {
      const r = await tool.execute({ action: "mcp_remove_server", mcp_server_name: "bad name!" });
      expect(r).toContain("Error");
    });
  });

  describe("validate_params", () => {
    it("action 없으면 validation error", () => {
      const errors = tool.validate_params({});
      expect(errors.length).toBeGreaterThan(0);
    });

    it("action 있으면 validation 통과", () => {
      const errors = tool.validate_params({ action: "skill_list" });
      expect(errors).toHaveLength(0);
    });
  });
});

// ══════════════════════════════════════════════════════════
// parse_skill_name 분기 테스트
// ══════════════════════════════════════════════════════════

describe("RuntimeAdminTool — parse_skill_name 분기 (L52/L57)", () => {
  let workspace: string;
  let tool: RuntimeAdminTool;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "ra-cov2-"));
    const installer = new ToolInstallerService(workspace);
    tool = new RuntimeAdminTool({ workspace, installer });

    const skills_dir = join(workspace, "skills");

    await mkdir(join(skills_dir, "no-frontmatter"), { recursive: true });
    await writeFile(join(skills_dir, "no-frontmatter", "SKILL.MD"), "# Just content, no frontmatter");

    await mkdir(join(skills_dir, "no-name-field"), { recursive: true });
    await writeFile(join(skills_dir, "no-name-field", "SKILL.MD"), "---\ndescription: test skill\n---\n# Content");

    await mkdir(join(skills_dir, "with-name"), { recursive: true });
    await writeFile(join(skills_dir, "with-name", "SKILL.MD"), '---\nname: "MyDeclaredSkill"\n---\n# Content');
  });

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("skill_list: 프론트매터 없는 SKILL.MD → 경로 기반 이름 사용 (L52)", async () => {
    const r = JSON.parse(await tool.execute({ action: "skill_list" })) as Array<Record<string, unknown>>;
    expect(Array.isArray(r)).toBe(true);
    const found = r.find((s) => String(s.name || "").toLowerCase().includes("no-frontmatter"));
    expect(found).toBeTruthy();
  });

  it("skill_list: name 없는 프론트매터 → 경로 기반 이름 사용 (L57)", async () => {
    const r = JSON.parse(await tool.execute({ action: "skill_list" })) as Array<Record<string, unknown>>;
    const found = r.find((s) => String(s.name || "").toLowerCase().includes("no-name-field"));
    expect(found).toBeTruthy();
  });

  it("skill_list: name 있는 SKILL.MD → 선언된 이름 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "skill_list" })) as Array<Record<string, unknown>>;
    const found = r.find((s) => s.name === "MyDeclaredSkill");
    expect(found).toBeTruthy();
  });
});
