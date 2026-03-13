import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { WorkspaceRegistry } from "@src/workspace/registry.js";
import { WorkspaceRuntime } from "@src/workspace/runtime.js";

function make_registry(): { registry: WorkspaceRegistry; root: string } {
  const root = join(tmpdir(), `ws-registry-test-${randomUUID()}`);
  return { registry: new WorkspaceRegistry(root), root };
}

// ══════════════════════════════════════════
// WorkspaceRuntime — 클래스 단위 테스트
// ══════════════════════════════════════════

describe("WorkspaceRuntime — identity + lifecycle", () => {
  it("constructor로 identity 필드 설정", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    expect(rt.team_id).toBe("t1");
    expect(rt.user_id).toBe("u1");
    expect(rt.workspace_path).toBe("/ws/t1/u1");
  });

  it("초기 상태: is_active=true, started_at 존재", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    expect(rt.is_active).toBe(true);
    expect(rt.started_at).toBeTruthy();
    expect(rt.last_accessed_at).toBe(rt.started_at);
  });

  it("touch() → last_accessed_at 갱신", async () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    const before = rt.last_accessed_at;
    await new Promise((r) => setTimeout(r, 5));
    rt.touch();
    expect(rt.last_accessed_at).not.toBe(before);
  });

  it("stop() → is_active=false", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    rt.stop();
    expect(rt.is_active).toBe(false);
  });

  it("stop() 후 touch() → 에러", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    rt.stop();
    expect(() => rt.touch()).toThrow();
  });

  it("WorkspaceRuntimeLike 구조 만족 (structural type check)", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    expect(typeof rt.team_id).toBe("string");
    expect(typeof rt.user_id).toBe("string");
    expect(typeof rt.workspace_path).toBe("string");
    expect(typeof rt.is_active).toBe("boolean");
    expect(typeof rt.started_at).toBe("string");
  });
});

// ══════════════════════════════════════════
// WorkspaceRuntime — workspace_layers / runtime_path
// ══════════════════════════════════════════

describe("WorkspaceRuntime — workspace_layers / runtime_path", () => {
  it("workspace_layers 기본값은 빈 배열", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    expect(rt.workspace_layers).toEqual([]);
  });

  it("constructor에 workspace_layers 전달 시 설정됨", () => {
    const layers = ["/root", "/root/tenants/t1", "/root/tenants/t1/users/u1"];
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1", layers);
    expect(rt.workspace_layers).toEqual(layers);
    expect(rt.workspace_layers).not.toBe(layers); // 방어 복사
  });

  it("runtime_path는 workspace_path/runtime", () => {
    const rt = new WorkspaceRuntime("t1", "u1", "/ws/t1/u1");
    expect(rt.runtime_path).toBe(join("/ws/t1/u1", "runtime"));
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — get_or_create()
// ══════════════════════════════════════════

describe("WorkspaceRegistry — get_or_create()", () => {
  it("처음 호출 시 WorkspaceRuntime 반환 및 디렉토리 생성", () => {
    const { registry } = make_registry();
    const rt = registry.get_or_create({ team_id: "team-a", user_id: "user-1" });
    expect(rt).toBeInstanceOf(WorkspaceRuntime);
    expect(rt.is_active).toBe(true);
    expect(rt.workspace_path).toBeTruthy();
    expect(existsSync(join(rt.workspace_path, "runtime"))).toBe(true);
    expect(existsSync(join(rt.workspace_path, "workflows"))).toBe(true);
    expect(existsSync(join(rt.workspace_path, "skills"))).toBe(true);
    expect(existsSync(join(rt.workspace_path, "templates"))).toBe(true);
  });

  it("같은 key 재호출 → 동일 인스턴스, last_accessed_at 갱신", async () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    const t1 = e1.last_accessed_at;
    await new Promise((r) => setTimeout(r, 5));
    const e2 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    expect(e1).toBe(e2);
    expect(e2.last_accessed_at >= t1).toBe(true);
  });

  it("workspace_path는 root/tenants/<team>/users/<user> 구조", () => {
    const { registry, root } = make_registry();
    const rt = registry.get_or_create({ team_id: "my-team", user_id: "user-42" });
    expect(rt.workspace_path).toBe(join(root, "tenants", "my-team", "users", "user-42"));
  });

  it("다른 사용자는 별도 경로", () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    const e2 = registry.get_or_create({ team_id: "t1", user_id: "u2" });
    expect(e1.workspace_path).not.toBe(e2.workspace_path);
  });

  it("같은 사용자라도 다른 팀이면 별도 경로", () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "team-a", user_id: "u1" });
    const e2 = registry.get_or_create({ team_id: "team-b", user_id: "u1" });
    expect(e1.workspace_path).not.toBe(e2.workspace_path);
  });

  it("get_or_create() → workspace_layers 3-tier [global, team, personal]", () => {
    const { registry, root } = make_registry();
    const rt = registry.get_or_create({ team_id: "team-a", user_id: "user-1" });
    expect(rt.workspace_layers).toEqual([
      root,
      join(root, "tenants", "team-a"),
      rt.workspace_path,
    ]);
  });

  it("get_or_create() → runtime_path는 workspace_path/runtime", () => {
    const { registry } = make_registry();
    const rt = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    expect(rt.runtime_path).toBe(join(rt.workspace_path, "runtime"));
  });

  it("started_at은 최초 등록 시각, 이후 재호출해도 변하지 않음", async () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "t", user_id: "u" });
    const started = e1.started_at;
    await new Promise((r) => setTimeout(r, 5));
    registry.get_or_create({ team_id: "t", user_id: "u" });
    expect(e1.started_at).toBe(started);
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — resolve_path()
// ══════════════════════════════════════════

describe("WorkspaceRegistry — resolve_path()", () => {
  it("디렉토리 생성 없이 경로만 반환", () => {
    const { registry, root } = make_registry();
    const path = registry.resolve_path("my-team", "my-user");
    expect(path).toBe(join(root, "tenants", "my-team", "users", "my-user"));
    expect(existsSync(path)).toBe(false);
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — remove()
// ══════════════════════════════════════════

describe("WorkspaceRegistry — remove()", () => {
  it("등록된 항목 제거 + 런타임 중지", () => {
    const { registry } = make_registry();
    const rt = registry.get_or_create({ team_id: "t", user_id: "u" });
    expect(registry.size).toBe(1);
    expect(registry.remove({ team_id: "t", user_id: "u" })).toBe(true);
    expect(registry.size).toBe(0);
    expect(rt.is_active).toBe(false);
  });

  it("없는 항목 제거 → false", () => {
    expect(make_registry().registry.remove({ team_id: "t", user_id: "u" })).toBe(false);
  });

  it("파일 시스템은 영향 없음 (경로 유지)", () => {
    const { registry } = make_registry();
    const rt = registry.get_or_create({ team_id: "t", user_id: "u" });
    registry.remove({ team_id: "t", user_id: "u" });
    expect(existsSync(rt.workspace_path)).toBe(true);
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — runtime lifecycle
// ══════════════════════════════════════════

describe("WorkspaceRegistry — runtime lifecycle", () => {
  it("get_runtime → 활성 런타임 반환 + touch()", async () => {
    const { registry } = make_registry();
    const created = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    const before = created.last_accessed_at;
    await new Promise((r) => setTimeout(r, 5));
    const rt = registry.get_runtime({ team_id: "t1", user_id: "u1" });
    expect(rt).toBe(created);
    expect(rt!.last_accessed_at).not.toBe(before);
  });

  it("get_runtime → 미등록 키 null", () => {
    const { registry } = make_registry();
    expect(registry.get_runtime({ team_id: "t1", user_id: "u1" })).toBeNull();
  });

  it("stop_runtime → 런타임 중지 + 레지스트리 제거", () => {
    const { registry } = make_registry();
    const rt = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    expect(registry.stop_runtime({ team_id: "t1", user_id: "u1" })).toBe(true);
    expect(rt.is_active).toBe(false);
    expect(registry.get_runtime({ team_id: "t1", user_id: "u1" })).toBeNull();
    expect(registry.size).toBe(0);
  });

  it("stop_runtime → 미등록 키 false", () => {
    const { registry } = make_registry();
    expect(registry.stop_runtime({ team_id: "t1", user_id: "u1" })).toBe(false);
  });

  it("stop_all → 모든 런타임 중지 + 레지스트리 클리어", () => {
    const { registry } = make_registry();
    const rt1 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    const rt2 = registry.get_or_create({ team_id: "t2", user_id: "u2" });
    registry.stop_all();
    expect(rt1.is_active).toBe(false);
    expect(rt2.is_active).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("팀 전환 시나리오: 동일 유저, 다른 팀 → 독립 런타임", () => {
    const { registry } = make_registry();
    const rt_t1 = registry.get_or_create({ team_id: "t1", user_id: "alice" });
    const rt_t2 = registry.get_or_create({ team_id: "t2", user_id: "alice" });
    expect(rt_t1).not.toBe(rt_t2);
    expect(rt_t1.workspace_path).not.toBe(rt_t2.workspace_path);
    // t1 중지해도 t2 영향 없음
    registry.stop_runtime({ team_id: "t1", user_id: "alice" });
    expect(rt_t1.is_active).toBe(false);
    expect(rt_t2.is_active).toBe(true);
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — list_active() / list_by_team()
// ══════════════════════════════════════════

describe("WorkspaceRegistry — list_active() / list_by_team()", () => {
  it("초기 상태: 빈 배열", () => {
    expect(make_registry().registry.list_active()).toHaveLength(0);
  });

  it("여러 사용자 등록 후 전체 목록", () => {
    const { registry } = make_registry();
    registry.get_or_create({ team_id: "t1", user_id: "u1" });
    registry.get_or_create({ team_id: "t1", user_id: "u2" });
    registry.get_or_create({ team_id: "t2", user_id: "u3" });
    expect(registry.list_active()).toHaveLength(3);
  });

  it("list_by_team → 해당 팀 사용자만", () => {
    const { registry } = make_registry();
    registry.get_or_create({ team_id: "t1", user_id: "u1" });
    registry.get_or_create({ team_id: "t1", user_id: "u2" });
    registry.get_or_create({ team_id: "t2", user_id: "u3" });
    expect(registry.list_by_team("t1")).toHaveLength(2);
    expect(registry.list_by_team("t2")).toHaveLength(1);
    expect(registry.list_by_team("t3")).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// WorkspaceRegistry — size / stop_all()
// ══════════════════════════════════════════

describe("WorkspaceRegistry — size / stop_all()", () => {
  it("size는 등록된 항목 수", () => {
    const { registry } = make_registry();
    expect(registry.size).toBe(0);
    registry.get_or_create({ team_id: "t", user_id: "u1" });
    registry.get_or_create({ team_id: "t", user_id: "u2" });
    expect(registry.size).toBe(2);
  });

  it("stop_all() 후 size=0, list_active() 빈 배열", () => {
    const { registry } = make_registry();
    registry.get_or_create({ team_id: "t", user_id: "u" });
    registry.stop_all();
    expect(registry.size).toBe(0);
    expect(registry.list_active()).toHaveLength(0);
  });
});
