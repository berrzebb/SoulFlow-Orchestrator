/**
 * AgentDefinitionStore — 3-tier scope 필터링 + CRUD 테스트.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDefinitionStore, type ScopeFilter } from "@src/agent/agent-definition.store.ts";
import type { CreateAgentDefinitionInput } from "@src/agent/agent-definition.types.ts";

describe("AgentDefinitionStore — scope", () => {
  let workspace: string;

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  function make_input(patch: Partial<CreateAgentDefinitionInput> = {}): CreateAgentDefinitionInput {
    return {
      name: patch.name ?? "Test Agent",
      description: patch.description ?? "Test",
      icon: patch.icon ?? "🤖",
      role_skill: patch.role_skill ?? null,
      soul: patch.soul ?? "",
      heart: patch.heart ?? "",
      tools: patch.tools ?? [],
      shared_protocols: patch.shared_protocols ?? [],
      skills: patch.skills ?? [],
      use_when: patch.use_when ?? "",
      not_use_for: patch.not_use_for ?? "",
      extra_instructions: patch.extra_instructions ?? "",
      preferred_providers: patch.preferred_providers ?? [],
      model: patch.model ?? null,
      is_builtin: patch.is_builtin ?? false,
      scope_type: patch.scope_type,
      scope_id: patch.scope_id,
    };
  }

  it("scope 미지정 시 global 기본값", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-scope-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    const def = store.create(make_input({ name: "No Scope" }));
    expect(def.scope_type).toBe("global");
    expect(def.scope_id).toBe("");
  });

  it("scope_type/scope_id 지정하여 생성", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-scope2-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    const def = store.create(make_input({
      name: "Team Agent",
      scope_type: "team",
      scope_id: "team-alpha",
    }));
    expect(def.scope_type).toBe("team");
    expect(def.scope_id).toBe("team-alpha");
  });

  it("list(undefined) → 전체 반환 (빌트인 포함)", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-list-all-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    store.create(make_input({ name: "Global", scope_type: "global" }));
    store.create(make_input({ name: "Team", scope_type: "team", scope_id: "t1" }));
    store.create(make_input({ name: "Personal", scope_type: "personal", scope_id: "u1" }));
    const all = store.list(undefined);
    const custom = all.filter((d) => !d.is_builtin);
    expect(custom.length).toBe(3);
  });

  it("list(scope_filter) → 해당 scope만 필터링", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-filter-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    store.create(make_input({ name: "Global Agent", scope_type: "global", scope_id: "" }));
    store.create(make_input({ name: "Team A Agent", scope_type: "team", scope_id: "tA" }));
    store.create(make_input({ name: "Team B Agent", scope_type: "team", scope_id: "tB" }));
    store.create(make_input({ name: "User1 Agent", scope_type: "personal", scope_id: "u1" }));
    store.create(make_input({ name: "User2 Agent", scope_type: "personal", scope_id: "u2" }));

    // user u1 in team tA → global + team:tA + personal:u1
    const filter: ScopeFilter = [
      { scope_type: "global", scope_id: "" },
      { scope_type: "team", scope_id: "tA" },
      { scope_type: "personal", scope_id: "u1" },
    ];
    const result = store.list(filter);
    const custom = result.filter((d) => !d.is_builtin);
    const names = custom.map((d) => d.name).sort();
    expect(names).toEqual(["Global Agent", "Team A Agent", "User1 Agent"]);
  });

  it("list(scope_filter) → global은 항상 포함", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-global-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    store.create(make_input({ name: "Global", scope_type: "global" }));
    store.create(make_input({ name: "Other Team", scope_type: "team", scope_id: "tX" }));

    // 빈 filter (team/personal 없음)에서도 global은 포함
    const result = store.list([]);
    const custom = result.filter((d) => !d.is_builtin);
    expect(custom.map((d) => d.name)).toEqual(["Global"]);
  });

  it("update → scope_type/scope_id 변경 가능", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-update-scope-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    const def = store.create(make_input({ name: "Movable", scope_type: "personal", scope_id: "u1" }));
    expect(def.scope_type).toBe("personal");

    store.update(def.id, { scope_type: "team", scope_id: "t1" });
    const updated = store.get(def.id);
    expect(updated!.scope_type).toBe("team");
    expect(updated!.scope_id).toBe("t1");
  });

  it("fork → 원본 scope 유지", async () => {
    workspace = await mkdtemp(join(tmpdir(), "def-fork-scope-"));
    const store = new AgentDefinitionStore(join(workspace, "defs.db"));
    const original = store.create(make_input({ name: "Original", scope_type: "team", scope_id: "t1" }));
    const forked = store.fork(original.id);
    expect(forked).not.toBeNull();
    expect(forked!.scope_type).toBe("team");
    expect(forked!.scope_id).toBe("t1");
    expect(forked!.name).toBe("Original (복사본)");
  });
});
