/**
 * RP-1: RolePolicyResolver 테스트.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  create_role_policy_resolver,
  type RolePolicySkillSource,
} from "../../src/orchestration/role-policy-resolver.js";
import type { SkillMetadata } from "../../src/agent/skills.types.js";

function make_role_meta(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    name: "role:implementer",
    path: "d:/test/src/skills/roles/implementer/SKILL.md",
    source: "builtin_skills",
    type: "role",
    always: false,
    summary: "코드 구현. Use when 스펙 확정된 코드 작성. Do NOT use for 설계, 리뷰.",
    aliases: [],
    triggers: [],
    tools: ["read_file", "write_file", "exec"],
    requirements: [],
    model: "remote",
    frontmatter: {},
    role: "implementer",
    soul: "항상 스펙을 먼저 읽는다.",
    heart: "반드시 빌드/테스트를 실행한 후 보고한다.",
    shared_protocols: ["clarification-protocol", "spp-deliberation"],
    preferred_providers: [],
    oauth: [],
    intents: [],
    file_patterns: [],
    code_patterns: [],
    checks: [],
    project_docs: false,
    ...overrides,
  };
}

function make_source(roles: SkillMetadata[]): RolePolicySkillSource {
  return {
    get_role_skill(role: string) {
      return roles.find(r => r.role === role) || null;
    },
    list_role_skills() {
      return roles;
    },
  };
}

describe("RolePolicyResolver", () => {
  it("존재하는 role → RolePolicy 정규화", () => {
    const source = make_source([make_role_meta()]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer");

    expect(policy).not.toBeNull();
    expect(policy!.role_id).toBe("implementer");
    expect(policy!.soul).toBe("항상 스펙을 먼저 읽는다.");
    expect(policy!.heart).toBe("반드시 빌드/테스트를 실행한 후 보고한다.");
    expect(policy!.tools).toEqual(["read_file", "write_file", "exec"]);
    expect(policy!.shared_protocols).toEqual(["clarification-protocol", "spp-deliberation"]);
    expect(policy!.preferred_model).toBe("remote");
  });

  it("description에서 use_when/not_use_for 추출", () => {
    const source = make_source([make_role_meta()]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;

    expect(policy.use_when).toBe("스펙 확정된 코드 작성");
    expect(policy.not_use_for).toBe("설계, 리뷰");
  });

  it("존재하지 않는 role → null", () => {
    const source = make_source([]);
    const resolver = create_role_policy_resolver(source);
    expect(resolver.resolve("nonexistent")).toBeNull();
  });

  it("soul/heart가 없는 role → 빈 문자열", () => {
    const meta = make_role_meta({ soul: null, heart: null });
    const source = make_source([meta]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;

    expect(policy.soul).toBe("");
    expect(policy.heart).toBe("");
  });

  it("list_roles → 등록된 역할 ID 목록", () => {
    const source = make_source([
      make_role_meta({ role: "implementer" }),
      make_role_meta({ role: "reviewer", name: "role:reviewer" }),
    ]);
    const resolver = create_role_policy_resolver(source);
    const roles = resolver.list_roles();

    expect(roles).toContain("implementer");
    expect(roles).toContain("reviewer");
    expect(roles).toHaveLength(2);
  });

  it("description에 Use when 없으면 빈 문자열", () => {
    const meta = make_role_meta({ summary: "단순 설명" });
    const source = make_source([meta]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;

    expect(policy.use_when).toBe("");
    expect(policy.not_use_for).toBe("");
  });

  it("role이 null인 메타 → role_id에 name 사용", () => {
    const meta = make_role_meta({ role: null });
    // role이 null이면 get_role_skill이 못 찾으므로 직접 바인딩
    const resolver = create_role_policy_resolver({
      get_role_skill: () => meta,
      list_role_skills: () => [meta],
    });
    const policy = resolver.resolve("anything")!;
    expect(policy.role_id).toBe("role:implementer");
  });

  it("model이 null → preferred_model null", () => {
    const meta = make_role_meta({ model: null });
    const source = make_source([meta]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;
    expect(policy.preferred_model).toBeNull();
  });
});

describe("RolePolicyResolver — load_resource 파일 로드", () => {
  let tmp_dir: string;
  let skill_path: string;

  beforeAll(() => {
    tmp_dir = mkdtempSync(join(tmpdir(), "rp-test-"));
    const resources_dir = join(tmp_dir, "resources");
    mkdirSync(resources_dir, { recursive: true });
    writeFileSync(join(resources_dir, "execution-protocol.md"), "1. 스펙 확인\n2. 구현\n3. 테스트");
    writeFileSync(join(resources_dir, "checklist.md"), "- [ ] 빌드 통과\n- [ ] 테스트 통과");
    writeFileSync(join(resources_dir, "error-playbook.md"), "## 빌드 실패\n재시도 후 보고.");
    skill_path = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_path, "---\nname: role:implementer\n---\nBody.");
  });

  afterAll(() => {
    rmSync(tmp_dir, { recursive: true, force: true });
  });

  it("resources/*.md 파일이 있으면 로드", () => {
    const meta = make_role_meta({ path: skill_path });
    const source = make_source([meta]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;

    expect(policy.execution_protocol).toContain("스펙 확인");
    expect(policy.checklist).toContain("빌드 통과");
    expect(policy.error_playbook).toContain("빌드 실패");
  });

  it("resources/ 디렉토리가 없으면 null", () => {
    const meta = make_role_meta({ path: "d:/nonexistent/path/SKILL.md" });
    const source = make_source([meta]);
    const resolver = create_role_policy_resolver(source);
    const policy = resolver.resolve("implementer")!;

    expect(policy.execution_protocol).toBeNull();
    expect(policy.checklist).toBeNull();
    expect(policy.error_playbook).toBeNull();
  });
});
