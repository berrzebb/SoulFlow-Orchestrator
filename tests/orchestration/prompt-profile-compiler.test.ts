/**
 * RP-3: PromptProfileCompiler 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  create_prompt_profile_compiler,
} from "../../src/orchestration/prompt-profile-compiler.js";
import type { RolePolicyResolverLike, RolePolicy } from "../../src/orchestration/role-policy-resolver.js";
import type { ProtocolResolverLike, ResolvedProtocol } from "../../src/orchestration/protocol-resolver.js";

function make_policy(overrides: Partial<RolePolicy> = {}): RolePolicy {
  return {
    role_id: "implementer",
    soul: "항상 스펙을 먼저 읽는다.",
    heart: "반드시 빌드/테스트를 실행한 후 보고한다.",
    tools: ["read_file", "write_file", "exec"],
    shared_protocols: ["clarification-protocol", "spp-deliberation"],
    preferred_model: "remote",
    use_when: "스펙 확정된 코드 작성",
    not_use_for: "설계, 리뷰",
    execution_protocol: "1. 스펙 확인\n2. 구현",
    checklist: "- [ ] 빌드 통과",
    error_playbook: "## 빌드 실패\n재시도.",
    ...overrides,
  };
}

function make_policy_resolver(policies: Record<string, RolePolicy>): RolePolicyResolverLike {
  return {
    resolve(role_id: string) {
      return policies[role_id] || null;
    },
    list_roles() {
      return Object.keys(policies);
    },
  };
}

function make_protocol_resolver(protocols: Record<string, string>): ProtocolResolverLike {
  return {
    resolve(names: readonly string[]) {
      const results: ResolvedProtocol[] = [];
      for (const name of names) {
        const content = protocols[name];
        if (content) results.push({ name, content });
      }
      return results;
    },
    resolve_one(name: string) {
      const content = protocols[name];
      if (!content) return null;
      return { name, content };
    },
    list_available() {
      return Object.keys(protocols);
    },
  };
}

describe("PromptProfileCompiler", () => {
  const policy = make_policy();
  const policy_resolver = make_policy_resolver({ implementer: policy });
  const protocol_resolver = make_protocol_resolver({
    "clarification-protocol": "# 명확화\n질문을 먼저 한다.",
    "spp-deliberation": "# SPP\n단계별 사고.",
  });

  it("compile → 존재하는 role → PromptProfile 반환", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer");

    expect(profile).not.toBeNull();
    expect(profile!.role_id).toBe("implementer");
    expect(profile!.soul).toBe("항상 스펙을 먼저 읽는다.");
    expect(profile!.heart).toBe("반드시 빌드/테스트를 실행한 후 보고한다.");
    expect(profile!.tools).toEqual(["read_file", "write_file", "exec"]);
    expect(profile!.preferred_model).toBe("remote");
    expect(profile!.use_when).toBe("스펙 확정된 코드 작성");
    expect(profile!.not_use_for).toBe("설계, 리뷰");
  });

  it("compile → protocol_sections에 해석된 프로토콜 포함", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;

    expect(profile.protocol_sections).toHaveLength(2);
    expect(profile.protocol_sections[0].name).toBe("clarification-protocol");
    expect(profile.protocol_sections[0].content).toContain("명확화");
    expect(profile.protocol_sections[1].name).toBe("spp-deliberation");
  });

  it("compile → resources 필드 전달", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;

    expect(profile.execution_protocol).toContain("스펙 확인");
    expect(profile.checklist).toContain("빌드 통과");
    expect(profile.error_playbook).toContain("빌드 실패");
  });

  it("compile → 존재하지 않는 role → null", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    expect(compiler.compile("nonexistent")).toBeNull();
  });

  it("compile → protocol이 일부만 존재하면 존재하는 것만 포함", () => {
    const partial_proto = make_protocol_resolver({
      "clarification-protocol": "# 명확화",
    });
    const compiler = create_prompt_profile_compiler(policy_resolver, partial_proto);
    const profile = compiler.compile("implementer")!;

    expect(profile.protocol_sections).toHaveLength(1);
    expect(profile.protocol_sections[0].name).toBe("clarification-protocol");
  });

  it("compile → resources가 null인 policy → null 유지", () => {
    const no_resources = make_policy({
      execution_protocol: null,
      checklist: null,
      error_playbook: null,
    });
    const resolver = make_policy_resolver({ implementer: no_resources });
    const compiler = create_prompt_profile_compiler(resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;

    expect(profile.execution_protocol).toBeNull();
    expect(profile.checklist).toBeNull();
    expect(profile.error_playbook).toBeNull();
  });
});

describe("PromptProfileCompiler — render_system_section", () => {
  const policy_resolver = make_policy_resolver({ implementer: make_policy() });
  const protocol_resolver = make_protocol_resolver({
    "clarification-protocol": "# 명확화\n질문을 먼저 한다.",
    "spp-deliberation": "# SPP\n단계별 사고.",
  });

  it("render → Role 헤더 포함", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).toContain("# Role: implementer");
  });

  it("render → Soul/Heart 포함", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).toContain("Soul: 항상 스펙을 먼저 읽는다.");
    expect(rendered).toContain("Heart: 반드시 빌드/테스트를 실행한 후 보고한다.");
  });

  it("render → Protocol 섹션 포함", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).toContain("## Protocol: clarification-protocol");
    expect(rendered).toContain("## Protocol: spp-deliberation");
  });

  it("render → Execution Protocol / Checklist / Error Playbook 포함", () => {
    const compiler = create_prompt_profile_compiler(policy_resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).toContain("## Execution Protocol");
    expect(rendered).toContain("스펙 확인");
    expect(rendered).toContain("## Checklist");
    expect(rendered).toContain("빌드 통과");
    expect(rendered).toContain("## Error Playbook");
    expect(rendered).toContain("빌드 실패");
  });

  it("render → null resources는 섹션 생략", () => {
    const no_resources = make_policy({
      execution_protocol: null,
      checklist: null,
      error_playbook: null,
      shared_protocols: [],
    });
    const resolver = make_policy_resolver({ implementer: no_resources });
    const empty_proto = make_protocol_resolver({});
    const compiler = create_prompt_profile_compiler(resolver, empty_proto);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).not.toContain("## Execution Protocol");
    expect(rendered).not.toContain("## Checklist");
    expect(rendered).not.toContain("## Error Playbook");
    expect(rendered).not.toContain("## Protocol:");
  });

  it("render → soul/heart 빈 문자열이면 생략", () => {
    const no_persona = make_policy({ soul: "", heart: "" });
    const resolver = make_policy_resolver({ implementer: no_persona });
    const compiler = create_prompt_profile_compiler(resolver, protocol_resolver);
    const profile = compiler.compile("implementer")!;
    const rendered = compiler.render_system_section(profile);

    expect(rendered).not.toContain("Soul:");
    expect(rendered).not.toContain("Heart:");
    expect(rendered).toContain("# Role: implementer");
  });
});
