/**
 * RuntimeAdminTool — 미커버 분기 (cov2):
 * - L52: parse_skill_name — 프론트매터 없음 → ""
 * - L57: parse_skill_name — frontmatter에 name: 없음 → ""
 * - L183: skill_list readFile catch — 읽기 실패 시 빈 문자열
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeAdminTool } from "@src/agent/tools/runtime-admin.ts";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";

let workspace: string;
let tool: RuntimeAdminTool;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ra-cov2-"));
  const installer = new ToolInstallerService(workspace);
  tool = new RuntimeAdminTool({ workspace, installer });

  // SKILL.MD 파일들을 수동 생성하여 parse_skill_name 특수 경로 트리거
  const skills_dir = join(workspace, "skills");

  // L52: 프론트매터 없는 SKILL.MD
  await mkdir(join(skills_dir, "no-frontmatter"), { recursive: true });
  await writeFile(join(skills_dir, "no-frontmatter", "SKILL.MD"), "# Just content, no frontmatter");

  // L57: 프론트매터 있지만 name: 없는 SKILL.MD
  await mkdir(join(skills_dir, "no-name-field"), { recursive: true });
  await writeFile(join(skills_dir, "no-name-field", "SKILL.MD"), "---\ndescription: test skill\n---\n# Content");

  // 정상 SKILL.MD (name: 있음)
  await mkdir(join(skills_dir, "with-name"), { recursive: true });
  await writeFile(join(skills_dir, "with-name", "SKILL.MD"), '---\nname: "MyDeclaredSkill"\n---\n# Content');
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("RuntimeAdminTool — parse_skill_name 분기 (L52/L57)", () => {
  it("skill_list: 프론트매터 없는 SKILL.MD → 경로 기반 이름 사용 (L52)", async () => {
    const r = JSON.parse(await tool.execute({ action: "skill_list" })) as Array<Record<string, unknown>>;
    expect(Array.isArray(r)).toBe(true);
    // no-frontmatter 스킬은 declared name="" → rel 경로명 사용
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
