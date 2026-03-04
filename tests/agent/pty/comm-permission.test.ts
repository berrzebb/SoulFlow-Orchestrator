import { describe, it, expect } from "vitest";
import { CommPermissionGuard, type CommPermissionRule } from "@src/agent/pty/comm-permission.ts";

describe("CommPermissionGuard", () => {
  it("규칙 없으면 기본 거부", () => {
    const guard = new CommPermissionGuard();
    expect(guard.is_allowed({ from: "a", to: "b" })).toBe(false);
  });

  it("정확 매칭 규칙이 허용한다", () => {
    const guard = new CommPermissionGuard([
      { from: "a", to: "b", allowed: true },
    ]);
    expect(guard.is_allowed({ from: "a", to: "b" })).toBe(true);
    expect(guard.is_allowed({ from: "b", to: "a" })).toBe(false);
  });

  it("from 와일드카드 매칭", () => {
    const guard = new CommPermissionGuard([
      { from: "*", to: "admin", allowed: true },
    ]);
    expect(guard.is_allowed({ from: "any-agent", to: "admin" })).toBe(true);
    expect(guard.is_allowed({ from: "any-agent", to: "other" })).toBe(false);
  });

  it("to 와일드카드 매칭", () => {
    const guard = new CommPermissionGuard([
      { from: "supervisor", to: "*", allowed: true },
    ]);
    expect(guard.is_allowed({ from: "supervisor", to: "worker-1" })).toBe(true);
    expect(guard.is_allowed({ from: "worker-1", to: "worker-2" })).toBe(false);
  });

  it("양쪽 와일드카드 매칭", () => {
    const guard = new CommPermissionGuard([
      { from: "*", to: "*", allowed: true },
    ]);
    expect(guard.is_allowed({ from: "x", to: "y" })).toBe(true);
  });

  it("정확 매칭이 와일드카드보다 우선", () => {
    const guard = new CommPermissionGuard([
      { from: "*", to: "*", allowed: true },
      { from: "a", to: "b", allowed: false },
    ]);
    expect(guard.is_allowed({ from: "a", to: "b" })).toBe(false);
    expect(guard.is_allowed({ from: "a", to: "c" })).toBe(true);
  });

  it("max_depth 초과 시 거부", () => {
    const guard = new CommPermissionGuard([
      { from: "a", to: "b", allowed: true, max_depth: 1 },
    ]);
    expect(guard.is_allowed({ from: "a", to: "b", depth: 0 })).toBe(true);
    expect(guard.is_allowed({ from: "a", to: "b", depth: 1 })).toBe(true);
    expect(guard.is_allowed({ from: "a", to: "b", depth: 2 })).toBe(false);
  });

  it("update_rules로 규칙 교체", () => {
    const guard = new CommPermissionGuard([
      { from: "a", to: "b", allowed: true },
    ]);
    expect(guard.is_allowed({ from: "a", to: "b" })).toBe(true);

    guard.update_rules([{ from: "a", to: "b", allowed: false }]);
    expect(guard.is_allowed({ from: "a", to: "b" })).toBe(false);
  });

  it("allowed: false 규칙이 명시적 거부로 동작", () => {
    const guard = new CommPermissionGuard([
      { from: "*", to: "*", allowed: true },
      { from: "banned", to: "*", allowed: false },
    ]);
    expect(guard.is_allowed({ from: "ok", to: "target" })).toBe(true);
    // banned → target: 정확 from 매칭(to wildcard)이 양쪽 와일드카드보다 우선
    expect(guard.is_allowed({ from: "banned", to: "target" })).toBe(false);
  });
});
