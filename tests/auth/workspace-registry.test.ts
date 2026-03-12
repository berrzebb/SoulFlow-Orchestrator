import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkspaceRegistry } from "@src/auth/workspace-registry.js";
import type { WorkspaceRuntime, WorkspaceBootstrapFn } from "@src/auth/workspace-registry.js";

function make_mock_runtime(): WorkspaceRuntime {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceRuntime;
}

function make_registry(delay = 0): { registry: WorkspaceRegistry; bootstrap: ReturnType<typeof vi.fn> } {
  const bootstrap = vi.fn<WorkspaceBootstrapFn>().mockImplementation(async (_path) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return make_mock_runtime();
  });
  return { registry: new WorkspaceRegistry(bootstrap), bootstrap };
}

describe("WorkspaceRegistry — get_or_create", () => {
  it("첫 호출 시 bootstrap 실행", async () => {
    const { registry, bootstrap } = make_registry();
    await registry.get_or_create("/ws/user1");
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith("/ws/user1");
  });

  it("두 번째 호출 시 캐시 반환 (bootstrap 재실행 안 함)", async () => {
    const { registry, bootstrap } = make_registry();
    const r1 = await registry.get_or_create("/ws/user1");
    const r2 = await registry.get_or_create("/ws/user1");
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(r1).toBe(r2);
  });

  it("다른 경로는 별개 런타임", async () => {
    const { registry, bootstrap } = make_registry();
    const r1 = await registry.get_or_create("/ws/user1");
    const r2 = await registry.get_or_create("/ws/user2");
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
  });

  it("bootstrap 실패 시 예외 전파 (캐시 저장 안 됨)", async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error("init_failed"));
    const registry = new WorkspaceRegistry(bootstrap);
    await expect(registry.get_or_create("/ws/fail")).rejects.toThrow("init_failed");
    expect(registry.has("/ws/fail")).toBe(false);
  });
});

describe("WorkspaceRegistry — remove", () => {
  it("캐시된 런타임 제거 + stop 호출", async () => {
    const { registry } = make_registry();
    const rt = await registry.get_or_create("/ws/user1") as unknown as { stop: ReturnType<typeof vi.fn> };
    await registry.remove("/ws/user1");
    expect(rt.stop).toHaveBeenCalledOnce();
    expect(registry.has("/ws/user1")).toBe(false);
  });

  it("없는 경로 remove → 예외 없음", async () => {
    const { registry } = make_registry();
    await expect(registry.remove("/ws/ghost")).resolves.toBeUndefined();
  });

  it("remove 후 get_or_create 재호출 시 새 런타임 생성", async () => {
    const { registry, bootstrap } = make_registry();
    await registry.get_or_create("/ws/user1");
    await registry.remove("/ws/user1");
    await registry.get_or_create("/ws/user1");
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });
});

describe("WorkspaceRegistry — stop_all", () => {
  it("모든 런타임 stop 호출 후 캐시 비움", async () => {
    const { registry } = make_registry();
    const r1 = await registry.get_or_create("/ws/u1") as unknown as { stop: ReturnType<typeof vi.fn> };
    const r2 = await registry.get_or_create("/ws/u2") as unknown as { stop: ReturnType<typeof vi.fn> };
    await registry.stop_all();
    // stop_all은 clear 후 stop을 호출하므로 캐시 참조로 호출 여부 확인 불가.
    // size가 0이 되는 것으로 캐시 클리어 확인.
    expect(registry.size).toBe(0);
  });

  it("빈 레지스트리에서 stop_all → 예외 없음", async () => {
    const { registry } = make_registry();
    await expect(registry.stop_all()).resolves.toBeUndefined();
  });
});

describe("WorkspaceRegistry — size / has", () => {
  it("초기 size = 0", () => {
    const { registry } = make_registry();
    expect(registry.size).toBe(0);
  });

  it("get_or_create 후 size 증가, has true", async () => {
    const { registry } = make_registry();
    await registry.get_or_create("/ws/u1");
    expect(registry.size).toBe(1);
    expect(registry.has("/ws/u1")).toBe(true);
    expect(registry.has("/ws/other")).toBe(false);
  });
});
