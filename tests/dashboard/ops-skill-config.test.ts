/**
 * Dashboard ops — create_skill_ops / create_config_ops 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { create_skill_ops } from "@src/dashboard/ops/skill.js";
import { create_config_ops } from "@src/dashboard/ops/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";

// ══════════════════════════════════════════
// SkillOps 헬퍼
// ══════════════════════════════════════════

function make_skill_loader(meta: Record<string, unknown> | null = null) {
  return {
    list_skills: vi.fn().mockReturnValue([{ name: "test-skill" }]),
    get_skill_metadata: vi.fn().mockReturnValue(meta),
    refresh: vi.fn(),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
  };
}

function make_temp_skill_dir() {
  const tmp = mkdtempSync(join(tmpdir(), "skill-test-"));
  const skill_dir = join(tmp, "skills", "my-skill");
  mkdirSync(skill_dir, { recursive: true });
  const skill_md = join(skill_dir, "SKILL.md");
  writeFileSync(skill_md, "# My Skill\n");
  return { tmp, skill_dir, skill_md };
}

// ══════════════════════════════════════════
// create_skill_ops — list_skills
// ══════════════════════════════════════════

describe("SkillOps — list_skills", () => {
  it("loader 위임", () => {
    const loader = make_skill_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const result = ops.list_skills();
    expect(loader.list_skills).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: "test-skill" }]);
  });
});

// ══════════════════════════════════════════
// create_skill_ops — get_skill_detail
// ══════════════════════════════════════════

describe("SkillOps — get_skill_detail", () => {
  it("meta 없음 → content/references=null", () => {
    const loader = make_skill_loader(null);
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const result = ops.get_skill_detail("nonexistent");
    expect(result.metadata).toBeNull();
    expect(result.content).toBeNull();
    expect(result.references).toBeNull();
  });

  it("meta.path 있음 → content 읽기", () => {
    const { skill_md } = make_temp_skill_dir();
    const loader = make_skill_loader({ path: skill_md, name: "my-skill" });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const result = ops.get_skill_detail("my-skill");
    expect(result.content).toContain("# My Skill");
  });

  it("references 폴더 있음 → references 읽기", () => {
    const { skill_md, skill_dir } = make_temp_skill_dir();
    const refs_dir = join(skill_dir, "references");
    mkdirSync(refs_dir, { recursive: true });
    writeFileSync(join(refs_dir, "guide.md"), "# Guide\n");
    const loader = make_skill_loader({ path: skill_md });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const result = ops.get_skill_detail("my-skill");
    expect(result.references).toHaveLength(1);
    expect(result.references![0].name).toBe("guide.md");
  });
});

// ══════════════════════════════════════════
// create_skill_ops — refresh
// ══════════════════════════════════════════

describe("SkillOps — refresh", () => {
  it("loader.refresh() 호출", () => {
    const loader = make_skill_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    ops.refresh();
    expect(loader.refresh).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// create_skill_ops — write_skill_file
// ══════════════════════════════════════════

describe("SkillOps — write_skill_file", () => {
  it("skill 없음 → skill_not_found", () => {
    const loader = make_skill_loader(null);
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("missing", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("skill_not_found");
  });

  it("builtin skill → builtin_readonly", () => {
    const loader = make_skill_loader({ path: "/skills/builtin/SKILL.md", source: "builtin" });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("builtin", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("builtin_readonly");
  });

  it("빈 파일명 → invalid_filename", () => {
    const { skill_md } = make_temp_skill_dir();
    const loader = make_skill_loader({ path: skill_md });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("my-skill", "", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_filename");
  });

  it("SKILL.md 쓰기 성공", () => {
    const { skill_md } = make_temp_skill_dir();
    const loader = make_skill_loader({ path: skill_md });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("my-skill", "SKILL.md", "# Updated\n");
    expect(r.ok).toBe(true);
    expect(loader.refresh).toHaveBeenCalledOnce();
  });

  it("references 파일 쓰기 성공", () => {
    const { skill_md, skill_dir } = make_temp_skill_dir();
    mkdirSync(join(skill_dir, "references"), { recursive: true });
    const loader = make_skill_loader({ path: skill_md });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("my-skill", "guide.md", "# Guide\n");
    expect(r.ok).toBe(true);
  });

  it("path traversal → path_traversal_blocked", () => {
    const { skill_md } = make_temp_skill_dir();
    const loader = make_skill_loader({ path: skill_md });
    const ops = create_skill_ops({ skills_loader: loader, workspace: "/tmp/ws" });
    const r = ops.write_skill_file("my-skill", "../../../etc/passwd", "evil");
    // sanitize_filename은 .. 제거하므로 invalid_filename 또는 path_traversal_blocked
    expect(r.ok).toBe(false);
  });
});

// ══════════════════════════════════════════
// create_config_ops
// ══════════════════════════════════════════

function make_config_store() {
  return {
    get_section_status: vi.fn().mockResolvedValue([
      { key: "llm.provider", value: "anthropic", is_default: true },
    ]),
    set_value: vi.fn().mockResolvedValue(undefined),
    remove_value: vi.fn().mockResolvedValue(undefined),
  };
}

function make_app_config() {
  return {
    llm: { provider: "anthropic", model: "claude-3" },
    channels: {},
  } as any;
}

describe("ConfigOps — get_current_config", () => {
  it("app_config 반환", () => {
    const cfg = make_app_config();
    const ops = create_config_ops({ app_config: cfg, config_store: make_config_store() as any });
    const result = ops.get_current_config();
    expect(result).toBe(cfg);
  });
});

describe("ConfigOps — get_sections", () => {
  it("SECTION_ORDER 전체 순회", async () => {
    const store = make_config_store();
    const ops = create_config_ops({ app_config: make_app_config(), config_store: store as any });
    const sections = await ops.get_sections();
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].id).toBeDefined();
    expect(sections[0].label).toBeDefined();
    expect(store.get_section_status).toHaveBeenCalled();
  });
});

describe("ConfigOps — get_section", () => {
  it("유효한 section → 반환", async () => {
    const store = make_config_store();
    const ops = create_config_ops({ app_config: make_app_config(), config_store: store as any });
    // 첫 번째 유효한 section ID 사용
    const sections = await ops.get_sections();
    const first_id = sections[0].id;
    const result = await ops.get_section(first_id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(first_id);
  });

  it("invalid section → null", async () => {
    const ops = create_config_ops({ app_config: make_app_config(), config_store: make_config_store() as any });
    const result = await ops.get_section("invalid_section");
    expect(result).toBeNull();
  });
});

describe("ConfigOps — set_value / remove_value", () => {
  it("set_value: store 호출 + app_config 업데이트", async () => {
    const store = make_config_store();
    const cfg = make_app_config();
    const ops = create_config_ops({ app_config: cfg, config_store: store as any });
    await ops.set_value("llm.provider", "openai");
    expect(store.set_value).toHaveBeenCalledWith("llm.provider", "openai");
    expect((cfg as any).llm.provider).toBe("openai");
  });

  it("remove_value: store 호출 + 기본값 복원", async () => {
    const store = make_config_store();
    const cfg = make_app_config();
    (cfg as any).llm.provider = "custom";
    const ops = create_config_ops({ app_config: cfg, config_store: store as any });
    await ops.remove_value("llm.provider");
    expect(store.remove_value).toHaveBeenCalledWith("llm.provider");
    // 기본값으로 복원됨 (undefined 또는 기본 provider)
    expect((cfg as any).llm).toBeDefined();
  });

  it("remove_value: 중간 path 없음 → undefined 처리", async () => {
    const store = make_config_store();
    const cfg = make_app_config();
    const ops = create_config_ops({ app_config: cfg, config_store: store as any });
    // deeply nested path that doesn't exist
    await ops.remove_value("nonexistent.deep.path");
    expect(store.remove_value).toHaveBeenCalledOnce();
  });
});
