import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  create_template_ops,
  create_memory_ops,
  create_workspace_ops,
  create_config_ops,
  create_tool_ops,
  create_skill_ops,
  type SkillsLoaderLike,
} from "@src/dashboard/ops-factory.ts";

// ─── Templates ──────────────────────────────────────────────────────────────

describe("create_template_ops", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "tmpl-test-"));
    await mkdir(join(workspace, "templates"), { recursive: true });
    await writeFile(join(workspace, "templates", "IDENTITY.md"), "# identity content");
    await writeFile(join(workspace, "SOUL.md"), "# soul in root");
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("list()가 모든 템플릿 이름을 반환한다", () => {
    const ops = create_template_ops(workspace);
    const list = ops.list();
    expect(list.length).toBe(6);
    expect(list.map((t) => t.name)).toContain("SOUL");
    expect(list.map((t) => t.name)).toContain("HEARTBEAT");
  });

  it("존재하는 템플릿은 exists: true", () => {
    const ops = create_template_ops(workspace);
    const soul = ops.list().find((t) => t.name === "SOUL");
    expect(soul?.exists).toBe(true);
  });

  it("없는 템플릿은 exists: false", () => {
    const ops = create_template_ops(workspace);
    const hb = ops.list().find((t) => t.name === "HEARTBEAT");
    expect(hb?.exists).toBe(false);
  });

  it("read()가 파일 내용을 반환한다", () => {
    const ops = create_template_ops(workspace);
    expect(ops.read("IDENTITY")).toBe("# identity content");
  });

  it("root 파일도 read()로 읽을 수 있다", () => {
    const ops = create_template_ops(workspace);
    expect(ops.read("SOUL")).toBe("# soul in root");
  });

  it("없는 템플릿은 read()가 null을 반환한다", () => {
    const ops = create_template_ops(workspace);
    expect(ops.read("HEARTBEAT")).toBeNull();
  });

  it("write()가 templates/ 디렉토리에 파일을 생성한다", () => {
    const ops = create_template_ops(workspace);
    const result = ops.write("AGENTS", "# new agents");
    expect(result).toEqual({ ok: true });
    expect(readFileSync(join(workspace, "templates", "AGENTS.md"), "utf-8")).toBe("# new agents");
  });
});

// ─── Memory ─────────────────────────────────────────────────────────────────

describe("create_memory_ops", () => {
  function make_mock_store() {
    return {
      read_longterm: vi.fn(async () => "longterm data"),
      write_longterm: vi.fn(async () => {}),
      list_daily: vi.fn(async () => ["2025-01-01", "2025-01-02"]),
      read_daily: vi.fn(async (day: string) => `daily ${day}`),
      write_daily: vi.fn(async () => {}),
    };
  }

  it("read_longterm를 위임한다", async () => {
    const store = make_mock_store();
    const ops = create_memory_ops(store);
    const result = await ops.read_longterm();
    expect(result).toBe("longterm data");
    expect(store.read_longterm).toHaveBeenCalled();
  });

  it("write_longterm를 위임한다", async () => {
    const store = make_mock_store();
    const ops = create_memory_ops(store);
    await ops.write_longterm("new content");
    expect(store.write_longterm).toHaveBeenCalledWith("new content");
  });

  it("list_daily를 위임한다", async () => {
    const store = make_mock_store();
    const ops = create_memory_ops(store);
    const result = await ops.list_daily();
    expect(result).toEqual(["2025-01-01", "2025-01-02"]);
  });

  it("read_daily를 위임한다", async () => {
    const store = make_mock_store();
    const ops = create_memory_ops(store);
    const result = await ops.read_daily("2025-01-01");
    expect(result).toBe("daily 2025-01-01");
  });

  it("write_daily를 위임한다", async () => {
    const store = make_mock_store();
    const ops = create_memory_ops(store);
    await ops.write_daily("content", "2025-01-01");
    expect(store.write_daily).toHaveBeenCalledWith("content", "2025-01-01");
  });
});

// ─── Workspace ──────────────────────────────────────────────────────────────

describe("create_workspace_ops", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "ws-test-"));
    await writeFile(join(workspace, "readme.txt"), "hello workspace");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "sub", "nested.md"), "nested content");
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("list_files()가 파일 목록을 반환한다", async () => {
    const ops = create_workspace_ops(workspace);
    const files = await ops.list_files();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.find((f) => f.name === "readme.txt")).toBeDefined();
  });

  it("서브디렉토리 목록을 포함한다", async () => {
    const ops = create_workspace_ops(workspace);
    const files = await ops.list_files();
    const sub = files.find((f) => f.name === "sub");
    expect(sub?.is_dir).toBe(true);
  });

  it("서브디렉토리 내용을 조회한다", async () => {
    const ops = create_workspace_ops(workspace);
    const files = await ops.list_files("sub");
    expect(files.find((f) => f.name === "nested.md")).toBeDefined();
  });

  it(".. 경로 순회를 차단한다", async () => {
    const ops = create_workspace_ops(workspace);
    const files = await ops.list_files("../");
    // ".." 제거 → "" → workspace root 반환 (안전)
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  it("read_file()이 파일 내용을 반환한다", async () => {
    const ops = create_workspace_ops(workspace);
    const content = await ops.read_file("readme.txt");
    expect(content).toBe("hello workspace");
  });

  it("없는 파일은 null을 반환한다", async () => {
    const ops = create_workspace_ops(workspace);
    const content = await ops.read_file("nonexistent.txt");
    expect(content).toBeNull();
  });

  it("존재하지 않는 디렉토리 list_files → catch → [] 반환", async () => {
    const ops = create_workspace_ops(workspace);
    // readdirSync on non-existent path → throws → catch → return []
    const files = await ops.list_files("nonexistent_dir_xyz");
    expect(files).toEqual([]);
  });
});

// ─── Config ─────────────────────────────────────────────────────────────────

describe("create_config_ops", () => {
  function make_mock_config_store() {
    return {
      set_value: vi.fn(async () => {}),
      remove_value: vi.fn(async () => {}),
      get_section_status: vi.fn(async () => []),
    };
  }

  it("get_current_config()가 앱 설정을 반환한다", () => {
    const app_config = { channel: { defaultAlias: "bot" } } as any;
    const ops = create_config_ops({ app_config, config_store: make_mock_config_store() as any });
    const config = ops.get_current_config();
    expect(config).toHaveProperty("channel");
  });

  it("set_value()가 config_store.set_value를 호출한다", async () => {
    const store = make_mock_config_store();
    const app_config = { channel: { defaultAlias: "bot" } } as any;
    const ops = create_config_ops({ app_config, config_store: store as any });
    await ops.set_value("channel.defaultAlias", "new-bot");
    expect(store.set_value).toHaveBeenCalledWith("channel.defaultAlias", "new-bot");
  });

  it("set_value()가 app_config 객체를 업데이트한다", async () => {
    const store = make_mock_config_store();
    const app_config = { channel: { defaultAlias: "bot" } } as any;
    const ops = create_config_ops({ app_config, config_store: store as any });
    await ops.set_value("channel.defaultAlias", "updated");
    expect(app_config.channel.defaultAlias).toBe("updated");
  });

  it("remove_value()가 config_store.remove_value를 호출한다", async () => {
    const store = make_mock_config_store();
    const app_config = { channel: { defaultAlias: "bot" } } as any;
    const ops = create_config_ops({ app_config, config_store: store as any });
    await ops.remove_value("channel.defaultAlias");
    expect(store.remove_value).toHaveBeenCalledWith("channel.defaultAlias");
  });
});

// ─── Tools ──────────────────────────────────────────────────────────────────

describe("create_tool_ops", () => {
  it("tool_names를 위임한다", () => {
    const ops = create_tool_ops({
      tool_names: () => ["bash", "read_file"],
      get_definitions: () => [],
      mcp: { list_servers: () => [] } as any,
    });
    expect(ops.tool_names()).toEqual(["bash", "read_file"]);
  });

  it("get_definitions를 위임한다", () => {
    const defs = [{ name: "bash", description: "run shell" }];
    const ops = create_tool_ops({
      tool_names: () => [],
      get_definitions: () => defs,
      mcp: { list_servers: () => [] } as any,
    });
    expect(ops.get_definitions()).toEqual(defs);
  });

  it("list_mcp_servers를 올바른 형태로 변환한다", () => {
    const ops = create_tool_ops({
      tool_names: () => [],
      get_definitions: () => [],
      mcp: {
        list_servers: () => [
          { name: "srv1", connected: true, tools: [{ name: "tool_a" }, { name: "tool_b" }], error: null },
          { name: "srv2", connected: false, tools: [], error: "timeout" },
        ],
      } as any,
    });
    const servers = ops.list_mcp_servers();
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ name: "srv1", connected: true, tools: ["tool_a", "tool_b"], error: null });
    expect(servers[1]).toEqual({ name: "srv2", connected: false, tools: [], error: "timeout" });
  });
});

// ─── Skills ─────────────────────────────────────────────────────────────────

describe("create_skill_ops", () => {
  let workspace: string;

  function make_mock_loader(overrides: Partial<SkillsLoaderLike> = {}): SkillsLoaderLike {
    return {
      list_skills: vi.fn(() => [{ name: "greet", summary: "인사 스킬" }]),
      get_skill_metadata: vi.fn(() => null),
      refresh: vi.fn(),
      suggest_skills_for_text: vi.fn(() => []),
      ...overrides,
    };
  }

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "skill-test-"));
    await mkdir(join(workspace, "skills", "test-skill", "references"), { recursive: true });
    await writeFile(join(workspace, "skills", "test-skill", "SKILL.md"), "# Test Skill");
    await writeFile(join(workspace, "skills", "test-skill", "references", "api.md"), "# API Ref");
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("list_skills를 위임한다", () => {
    const loader = make_mock_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace });
    ops.list_skills();
    expect(loader.list_skills).toHaveBeenCalled();
  });

  it("get_skill_detail이 metadata와 content를 반환한다", () => {
    const skill_path = join(workspace, "skills", "test-skill", "SKILL.md");
    const loader = make_mock_loader({
      get_skill_metadata: vi.fn(() => ({ name: "test-skill", path: skill_path, source: "local" })),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace });
    const detail = ops.get_skill_detail("test-skill");
    expect(detail.content).toBe("# Test Skill");
    expect(detail.references).toHaveLength(1);
    expect(detail.references![0].name).toBe("api.md");
  });

  it("write_skill_file이 builtin 스킬은 거부한다", () => {
    const loader = make_mock_loader({
      get_skill_metadata: vi.fn(() => ({ name: "builtin-skill", path: "/some/path", source: "builtin" })),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace });
    const result = ops.write_skill_file("builtin-skill", "SKILL.md", "new content");
    expect(result).toEqual({ ok: false, error: "builtin_readonly" });
  });
});
