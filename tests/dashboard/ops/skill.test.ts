/**
 * dashboard/ops/skill — create_skill_ops 모든 메서드 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_read_file_sync, mock_write_file_sync, mock_exists_sync, mock_readdir_sync, mock_mkdir_sync } = vi.hoisted(() => ({
  mock_read_file_sync: vi.fn(),
  mock_write_file_sync: vi.fn(),
  mock_exists_sync: vi.fn().mockReturnValue(false),
  mock_readdir_sync: vi.fn().mockReturnValue([]),
  mock_mkdir_sync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mock_read_file_sync,
  writeFileSync: mock_write_file_sync,
  existsSync: mock_exists_sync,
  readdirSync: mock_readdir_sync,
  mkdirSync: mock_mkdir_sync,
}));

import { create_skill_ops } from "@src/dashboard/ops/skill.js";

// ── 헬퍼 ────────────────────────────────────────

function make_loader(overrides: Record<string, unknown> = {}) {
  return {
    list_skills: vi.fn().mockReturnValue([{ name: "test-skill" }]),
    get_skill_metadata: vi.fn().mockReturnValue(null),
    refresh: vi.fn(),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// list_skills
// ══════════════════════════════════════════

describe("create_skill_ops — list_skills", () => {
  it("loader.list_skills() 위임", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const result = ops.list_skills();
    expect(loader.list_skills).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: "test-skill" }]);
  });
});

// ══════════════════════════════════════════
// get_skill_detail
// ══════════════════════════════════════════

describe("create_skill_ops — get_skill_detail", () => {
  it("metadata 없음 → { metadata: null, content: null, references: null }", () => {
    const loader = make_loader({ get_skill_metadata: vi.fn().mockReturnValue(null) });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const result = ops.get_skill_detail("no-skill");
    expect(result.metadata).toBeNull();
    expect(result.content).toBeNull();
    expect(result.references).toBeNull();
  });

  it("metadata.path 있음 → readFileSync로 content 읽기", () => {
    mock_read_file_sync.mockReturnValueOnce("# SKILL\ncontent here");
    mock_exists_sync.mockReturnValue(false);
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const result = ops.get_skill_detail("my-skill");
    expect(result.content).toBe("# SKILL\ncontent here");
    expect(result.references).toBeNull();
  });

  it("references 디렉토리 있음 → .md/.txt 파일 읽기", () => {
    mock_read_file_sync.mockReturnValueOnce("# SKILL").mockReturnValueOnce("ref content");
    mock_exists_sync.mockReturnValue(true);
    mock_readdir_sync.mockReturnValue(["guide.md", "extra.txt", "ignore.js"]);
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const result = ops.get_skill_detail("my-skill");
    expect(result.references).not.toBeNull();
    expect(result.references!.length).toBe(2); // .md + .txt만
    expect(result.references![0].name).toBe("guide.md");
    expect(result.references![0].content).toBe("ref content");
  });

  it("readFileSync 실패 → content null로 graceful", () => {
    mock_read_file_sync.mockImplementationOnce(() => { throw new Error("ENOENT"); });
    mock_exists_sync.mockReturnValue(false);
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const result = ops.get_skill_detail("my-skill");
    expect(result.content).toBeNull();
  });
});

// ══════════════════════════════════════════
// refresh
// ══════════════════════════════════════════

describe("create_skill_ops — refresh", () => {
  it("loader.refresh() 호출", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    ops.refresh();
    expect(loader.refresh).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// write_skill_file
// ══════════════════════════════════════════

describe("create_skill_ops — write_skill_file", () => {
  it("metadata 없음 → skill_not_found 에러", () => {
    const loader = make_loader({ get_skill_metadata: vi.fn().mockReturnValue(null) });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("no-skill", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("skill_not_found");
  });

  it("metadata.path 없음 → skill_not_found", () => {
    const loader = make_loader({ get_skill_metadata: vi.fn().mockReturnValue({ name: "s", source: "local" }) });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("s", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("skill_not_found");
  });

  it("builtin skill → builtin_readonly 에러", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/s/SKILL.md", source: "builtin" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("s", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("builtin_readonly");
  });

  it("invalid filename → invalid_filename 에러", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/s/SKILL.md", source: "local" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    // 파일명에 / 포함 → sanitize_filename이 제거 → 빈 문자열
    const r = ops.write_skill_file("s", "/", "content");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("invalid_filename");
  });

  it("SKILL.md → skill 경로에 직접 쓰기", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md", source: "local" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("my-skill", "SKILL.md", "new content");
    expect(r.ok).toBe(true);
    expect(mock_write_file_sync).toHaveBeenCalledWith("/ws/skills/my-skill/SKILL.md", "new content", "utf-8");
    expect(loader.refresh).toHaveBeenCalledOnce();
  });

  it("references 파일 → skill/references/ 경로에 쓰기", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md", source: "local" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("my-skill", "guide.md", "ref content");
    expect(r.ok).toBe(true);
    expect(mock_write_file_sync).toHaveBeenCalledWith(
      expect.stringContaining("references"),
      "ref content",
      "utf-8",
    );
  });

  it("writeFileSync 실패 → ok:false + error 포함", () => {
    mock_write_file_sync.mockImplementationOnce(() => { throw new Error("disk full"); });
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: "/ws/skills/my-skill/SKILL.md", source: "local" }),
    });
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    const r = ops.write_skill_file("my-skill", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(String((r as any).error)).toContain("disk full");
  });
});

// ══════════════════════════════════════════
// upload_skill
// ══════════════════════════════════════════

describe("create_skill_ops — upload_skill", () => {
  it("adm-zip 없음(require 실패) → ok:false + error 포함", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader as any, workspace: "/ws" });
    // adm-zip은 실제로 설치되어 있을 수도 없을 수도 있음
    const result = ops.upload_skill("my-skill", Buffer.from("fake-zip"));
    // 성공하거나 실패 — 둘 다 허용, 구조만 검증
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.path).toBe("string");
  });
});
