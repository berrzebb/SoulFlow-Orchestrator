/**
 * RP-6: Role Protocol Golden Tests.
 *
 * role 해석 → 프로필 컴파일 → 렌더링 파이프라인의 출력을 스냅샷으로 고정.
 * 프롬프트 구조 변경 시 의도적으로 실패하여 리뷰를 유도한다.
 */
import { describe, it, expect } from "vitest";
import { create_role_policy_resolver } from "@src/orchestration/role-policy-resolver.js";
import { create_protocol_resolver } from "@src/orchestration/protocol-resolver.js";
import { create_prompt_profile_compiler } from "@src/orchestration/prompt-profile-compiler.js";
import type { SkillMetadata } from "@src/agent/skills.types.js";

// ── Golden role fixtures ──────────────────────────────────────────────

type RoleFixture = Pick<SkillMetadata, "role" | "name" | "summary" | "soul" | "heart" | "tools" | "shared_protocols" | "model" | "path">;

const ROLE_FIXTURES: Record<string, RoleFixture> = {
  concierge: {
    role: "concierge", name: "role:concierge",
    summary: "Use when routing or greeting. Do NOT use for deep analysis.",
    soul: "A helpful concierge who routes requests to specialists.",
    heart: "Be warm, concise, and proactive in routing.",
    tools: [], shared_protocols: ["clarification-protocol"],
    model: null, path: null,
  },
  implementer: {
    role: "implementer", name: "role:implementer",
    summary: "Use when coding tasks. Do NOT use for design reviews.",
    soul: "A meticulous coder who values correctness.",
    heart: "Write clean, tested, minimal code. Follow project conventions.",
    tools: ["file_edit", "terminal"], shared_protocols: ["clarification-protocol", "phase-gates"],
    model: "sonnet", path: null,
  },
  reviewer: {
    role: "reviewer", name: "role:reviewer",
    summary: "Use when reviewing code or PRs. Do NOT use for implementation.",
    soul: "A thorough reviewer focused on correctness and maintainability.",
    heart: "Review with evidence. Cite lines. Severity: critical > major > minor.",
    tools: ["file_read", "web_search"], shared_protocols: [],
    model: "opus", path: null,
  },
  minimal: {
    role: "minimal", name: "role:minimal",
    summary: "",
    soul: null, heart: null,
    tools: [], shared_protocols: [],
    model: null, path: null,
  },
};

function make_skill_source(fixtures: Record<string, RoleFixture>) {
  const entries = Object.values(fixtures);
  return {
    get_role_skill(role: string) {
      return (entries.find((e) => e.role === role) as SkillMetadata | undefined) ?? null;
    },
    list_role_skills() { return entries as SkillMetadata[]; },
    get_shared_protocol() { return null as string | null; },
    list_shared_protocols() { return []; },
  };
}

function build_compiler(fixtures: Record<string, RoleFixture> = ROLE_FIXTURES) {
  const source = make_skill_source(fixtures);
  return create_prompt_profile_compiler(
    create_role_policy_resolver(source),
    create_protocol_resolver(source),
  );
}

// ── Golden cases ──────────────────────────────────────────────────────

type GoldenCase = {
  role_id: string;
  label: string;
  expected_resolve: {
    soul: string;
    heart: string;
    use_when: string;
    not_use_for: string;
    tools: readonly string[];
    preferred_model: string | null;
  };
  expected_render_contains: string[];
  expected_render_omits: string[];
};

const GOLDEN_CASES: GoldenCase[] = [
  {
    role_id: "concierge", label: "concierge — routing role",
    expected_resolve: {
      soul: "A helpful concierge who routes requests to specialists.",
      heart: "Be warm, concise, and proactive in routing.",
      use_when: "routing or greeting",
      not_use_for: "deep analysis",
      tools: [],
      preferred_model: null,
    },
    expected_render_contains: [
      "# Role: concierge",
      "Soul: A helpful concierge",
      "Heart: Be warm, concise",
    ],
    expected_render_omits: [
      "## Execution Protocol",
      "## Checklist",
      "## Error Playbook",
    ],
  },
  {
    role_id: "implementer", label: "implementer — coding role with protocols",
    expected_resolve: {
      soul: "A meticulous coder who values correctness.",
      heart: "Write clean, tested, minimal code. Follow project conventions.",
      use_when: "coding tasks",
      not_use_for: "design reviews",
      tools: ["file_edit", "terminal"],
      preferred_model: "sonnet",
    },
    expected_render_contains: [
      "# Role: implementer",
      "Soul: A meticulous coder",
      "Heart: Write clean, tested",
    ],
    expected_render_omits: [
      "## Error Playbook",
    ],
  },
  {
    role_id: "reviewer", label: "reviewer — review-only role",
    expected_resolve: {
      soul: "A thorough reviewer focused on correctness and maintainability.",
      heart: "Review with evidence. Cite lines. Severity: critical > major > minor.",
      use_when: "reviewing code or PRs",
      not_use_for: "implementation",
      tools: ["file_read", "web_search"],
      preferred_model: "opus",
    },
    expected_render_contains: [
      "# Role: reviewer",
      "Soul: A thorough reviewer",
    ],
    expected_render_omits: [
      "## Protocol:",
    ],
  },
  {
    role_id: "minimal", label: "minimal — empty fields omitted",
    expected_resolve: {
      soul: "",
      heart: "",
      use_when: "",
      not_use_for: "",
      tools: [],
      preferred_model: null,
    },
    expected_render_contains: [
      "# Role: minimal",
    ],
    expected_render_omits: [
      "Soul:",
      "Heart:",
      "## Execution Protocol",
      "## Checklist",
    ],
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("role protocol golden tests — resolve + compile + render", () => {
  const compiler = build_compiler();

  it.each(GOLDEN_CASES)(
    "[$label] resolve($role_id) → expected policy fields",
    ({ role_id, expected_resolve }) => {
      const profile = compiler.compile(role_id);
      expect(profile).not.toBeNull();
      expect(profile!.soul).toBe(expected_resolve.soul);
      expect(profile!.heart).toBe(expected_resolve.heart);
      expect(profile!.use_when).toBe(expected_resolve.use_when);
      expect(profile!.not_use_for).toBe(expected_resolve.not_use_for);
      expect([...profile!.tools]).toEqual([...expected_resolve.tools]);
      expect(profile!.preferred_model).toBe(expected_resolve.preferred_model);
    },
  );

  it.each(GOLDEN_CASES)(
    "[$label] render($role_id) contains expected sections",
    ({ role_id, expected_render_contains }) => {
      const profile = compiler.compile(role_id)!;
      const rendered = compiler.render_system_section(profile);
      for (const fragment of expected_render_contains) {
        expect(rendered).toContain(fragment);
      }
    },
  );

  it.each(GOLDEN_CASES)(
    "[$label] render($role_id) omits irrelevant sections",
    ({ role_id, expected_render_omits }) => {
      const profile = compiler.compile(role_id)!;
      const rendered = compiler.render_system_section(profile);
      for (const fragment of expected_render_omits) {
        expect(rendered).not.toContain(fragment);
      }
    },
  );

  it("nonexistent role → compile returns null", () => {
    expect(compiler.compile("ghost_role")).toBeNull();
  });
});

describe("golden test set coverage validation", () => {
  it("covers at least 4 role archetypes", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(4);
  });

  it("includes a minimal (empty fields) case", () => {
    const minimal = GOLDEN_CASES.find((c) => c.expected_resolve.soul === "" && c.expected_resolve.heart === "");
    expect(minimal).toBeDefined();
  });

  it("includes cases with and without preferred_model", () => {
    const with_model = GOLDEN_CASES.some((c) => c.expected_resolve.preferred_model !== null);
    const without_model = GOLDEN_CASES.some((c) => c.expected_resolve.preferred_model === null);
    expect(with_model).toBe(true);
    expect(without_model).toBe(true);
  });

  it("includes cases with and without tools", () => {
    const with_tools = GOLDEN_CASES.some((c) => c.expected_resolve.tools.length > 0);
    const without_tools = GOLDEN_CASES.some((c) => c.expected_resolve.tools.length === 0);
    expect(with_tools).toBe(true);
    expect(without_tools).toBe(true);
  });
});
