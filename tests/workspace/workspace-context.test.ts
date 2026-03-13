import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { create_workspace_context } from "../../src/workspace/workspace-context.js";

describe("create_workspace_context", () => {
  const ws = "/ws";

  it("단일 유저 모드 — team_id/user_id 미지정 시 모든 스코프 축소", () => {
    const ctx = create_workspace_context({ workspace: ws });
    const runtime = join(ws, "runtime");

    expect(ctx.workspace).toBe(ws);
    expect(ctx.admin_runtime).toBe(runtime);
    expect(ctx.team_runtime).toBe(runtime);
    expect(ctx.user_runtime).toBe(runtime);
    expect(ctx.user_content).toBe(ws);
    expect(ctx.team_id).toBe("");
    expect(ctx.user_id).toBe("");
  });

  it("team_id만 지정, user_id 미지정 → 단일 유저 모드 축소", () => {
    const ctx = create_workspace_context({ workspace: ws, team_id: "t1" });
    expect(ctx.team_id).toBe("");
    expect(ctx.team_runtime).toBe(join(ws, "runtime"));
  });

  it("멀티테넌트 — team_id/user_id 모두 지정 시 3-tier 분리", () => {
    const ctx = create_workspace_context({ workspace: ws, team_id: "t1", user_id: "u1" });

    expect(ctx.admin_runtime).toBe(join(ws, "runtime"));
    expect(ctx.team_id).toBe("t1");
    expect(ctx.team_runtime).toBe(join(ws, "tenants", "t1", "runtime"));
    expect(ctx.user_id).toBe("u1");
    expect(ctx.user_runtime).toBe(join(ws, "tenants", "t1", "users", "u1", "runtime"));
    expect(ctx.user_content).toBe(join(ws, "tenants", "t1", "users", "u1"));
  });

  it("AdminWorkspace 타입으로 좁혀도 admin_runtime 접근 가능", () => {
    const ctx = create_workspace_context({ workspace: ws, team_id: "t1", user_id: "u1" });
    // AdminWorkspace 인터페이스만 요구하는 함수에 전달 가능 (structural typing)
    const admin: { admin_runtime: string } = ctx;
    expect(admin.admin_runtime).toBe(join(ws, "runtime"));
  });

  it("TeamWorkspace 타입으로 좁혀도 team_runtime 접근 가능", () => {
    const ctx = create_workspace_context({ workspace: ws, team_id: "t1", user_id: "u1" });
    const team: { team_id: string; team_runtime: string; admin_runtime: string } = ctx;
    expect(team.team_runtime).toBe(join(ws, "tenants", "t1", "runtime"));
    expect(team.admin_runtime).toBe(join(ws, "runtime"));
  });
});
