import { describe, it, expect, beforeAll } from "vitest";
import { SkillsLoader } from "../../src/agent/skills.service.js";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");

describe("SkillsLoader 역할 스킬", () => {
  let loader: SkillsLoader;

  beforeAll(() => {
    loader = new SkillsLoader(workspace);
  });

  it("역할 스킬을 type=role로 파싱한다", () => {
    const skill = loader.get_role_skill("implementer");
    expect(skill).not.toBeNull();
    expect(skill!.type).toBe("role");
    expect(skill!.role).toBe("implementer");
    expect(skill!.name).toBe("role:implementer");
  });

  it("get_role_skill로 모든 역할을 조회할 수 있다", () => {
    const roles = ["butler", "pm", "pl", "generalist", "implementer", "reviewer", "debugger", "validator"];
    for (const role of roles) {
      const skill = loader.get_role_skill(role);
      expect(skill, `role:${role} should exist`).not.toBeNull();
      expect(skill!.role).toBe(role);
    }
  });

  it("list_role_skills가 역할 스킬만 반환한다", () => {
    const role_skills = loader.list_role_skills();
    expect(role_skills.length).toBeGreaterThanOrEqual(8);
    for (const s of role_skills) {
      expect(s.type).toBe("role");
      expect(s.role).toBeTruthy();
    }
  });

  it("역할 스킬의 shared_protocols가 파싱된다", () => {
    const skill = loader.get_role_skill("implementer");
    expect(skill).not.toBeNull();
    expect(skill!.shared_protocols).toContain("clarification-protocol");
    expect(skill!.shared_protocols).toContain("session-metrics");
  });

  it("_shared/ 프로토콜이 로드된다", () => {
    const protocol = loader.get_shared_protocol("clarification-protocol");
    expect(protocol).toBeTruthy();
    expect(protocol).toContain("LOW");
    expect(protocol).toContain("HIGH");
  });

  it("_shared/lang/ 서브디렉토리 프로토콜이 네임스페이스 키로 로드된다", () => {
    const ts = loader.get_shared_protocol("lang/typescript");
    expect(ts).toBeTruthy();
    expect(ts).toContain("tsc");

    const rust = loader.get_shared_protocol("lang/rust");
    expect(rust).toBeTruthy();
    expect(rust).toContain("cargo");
  });

  it("load_role_context가 프로토콜 + 역할 본문을 결합한다", () => {
    const ctx = loader.load_role_context("implementer");
    expect(ctx).toBeTruthy();
    // _shared/ 프로토콜이 포함되어야 함
    expect(ctx).toContain("Clarification Protocol");
    // 역할 본문이 포함되어야 함
    expect(ctx).toContain("Implementer");
  });

  it("역할 스킬은 suggest_skills_for_text에서 제외된다", () => {
    const suggestions = loader.suggest_skills_for_text("코드를 구현해주세요", 20);
    // 역할 스킬 이름(role:*)이 추천 목록에 포함되지 않아야 함
    for (const name of suggestions) {
      expect(name).not.toMatch(/^role:/);
    }
  });

  it("역할 스킬은 build_skill_summary에서 제외된다", () => {
    const summary = loader.build_skill_summary();
    expect(summary).not.toContain("role:implementer");
    expect(summary).not.toContain("role:butler");
  });

  it("list_skills에 type_filter 적용 시 역할만 반환된다", () => {
    const role_list = loader.list_skills(false, "role");
    expect(role_list.length).toBeGreaterThanOrEqual(8);
    for (const item of role_list) {
      expect(item.type).toBe("role");
    }

    const tool_list = loader.list_skills(false, "tool");
    for (const item of tool_list) {
      expect(item.type).not.toBe("role");
    }
  });

  it("존재하지 않는 역할은 null을 반환한다", () => {
    expect(loader.get_role_skill("nonexistent")).toBeNull();
    expect(loader.load_role_context("nonexistent")).toBeNull();
  });
});
