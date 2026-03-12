import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { WorkspaceRegistry } from "@src/workspace/registry.js";

function make_registry(): { registry: WorkspaceRegistry; root: string } {
  const root = join(tmpdir(), `ws-registry-test-${randomUUID()}`);
  return { registry: new WorkspaceRegistry(root), root };
}

describe("WorkspaceRegistry — get_or_create()", () => {
  it("처음 호출 시 workspace_path 반환 및 디렉토리 생성", () => {
    const { registry } = make_registry();
    const entry = registry.get_or_create({ team_id: "team-a", user_id: "user-1" });
    expect(entry.workspace_path).toBeTruthy();
    expect(existsSync(join(entry.workspace_path, "runtime"))).toBe(true);
    expect(existsSync(join(entry.workspace_path, "workflows"))).toBe(true);
    expect(existsSync(join(entry.workspace_path, "skills"))).toBe(true);
    expect(existsSync(join(entry.workspace_path, "templates"))).toBe(true);
  });

  it("같은 key 재호출 → 동일 entry, last_accessed_at 갱신", async () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    const t1 = e1.last_accessed_at;
    await new Promise((r) => setTimeout(r, 5)); // 시간 차이 보장
    const e2 = registry.get_or_create({ team_id: "t1", user_id: "u1" });
    expect(e1).toBe(e2); // 동일 참조
    expect(e2.last_accessed_at >= t1).toBe(true);
  });

  it("workspace_path는 root/tenants/<team>/users/<user> 구조", () => {
    const { registry, root } = make_registry();
    const entry = registry.get_or_create({ team_id: "my-team", user_id: "user-42" });
    expect(entry.workspace_path).toBe(join(root, "tenants", "my-team", "users", "user-42"));
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

  it("registered_at은 최초 등록 시각, 이후 재호출해도 변하지 않음", async () => {
    const { registry } = make_registry();
    const e1 = registry.get_or_create({ team_id: "t", user_id: "u" });
    const reg_at = e1.registered_at;
    await new Promise((r) => setTimeout(r, 5));
    registry.get_or_create({ team_id: "t", user_id: "u" });
    expect(e1.registered_at).toBe(reg_at);
  });
});

describe("WorkspaceRegistry — resolve_path()", () => {
  it("디렉토리 생성 없이 경로만 반환", () => {
    const { registry, root } = make_registry();
    const path = registry.resolve_path("my-team", "my-user");
    expect(path).toBe(join(root, "tenants", "my-team", "users", "my-user"));
    expect(existsSync(path)).toBe(false); // 디렉토리 미생성
  });
});

describe("WorkspaceRegistry — remove()", () => {
  it("등록된 항목 제거", () => {
    const { registry } = make_registry();
    registry.get_or_create({ team_id: "t", user_id: "u" });
    expect(registry.size).toBe(1);
    expect(registry.remove({ team_id: "t", user_id: "u" })).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("없는 항목 제거 → false", () => {
    expect(make_registry().registry.remove({ team_id: "t", user_id: "u" })).toBe(false);
  });

  it("파일 시스템은 영향 없음 (경로 유지)", () => {
    const { registry } = make_registry();
    const entry = registry.get_or_create({ team_id: "t", user_id: "u" });
    registry.remove({ team_id: "t", user_id: "u" });
    expect(existsSync(entry.workspace_path)).toBe(true); // 파일 삭제 안 함
  });
});

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

describe("WorkspaceRegistry — size / clear()", () => {
  it("size는 등록된 항목 수", () => {
    const { registry } = make_registry();
    expect(registry.size).toBe(0);
    registry.get_or_create({ team_id: "t", user_id: "u1" });
    registry.get_or_create({ team_id: "t", user_id: "u2" });
    expect(registry.size).toBe(2);
  });

  it("clear() 후 size=0, list_active() 빈 배열", () => {
    const { registry } = make_registry();
    registry.get_or_create({ team_id: "t", user_id: "u" });
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list_active()).toHaveLength(0);
  });
});
