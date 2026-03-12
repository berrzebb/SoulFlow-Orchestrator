/**
 * static-server — L22 커버리지: resolve_web_dir fallback (모든 후보 실패 시 candidates[0] 반환).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    accessSync: vi.fn().mockImplementation(() => { throw new Error("ENOENT"); }),
  };
});

describe("resolve_web_dir — L22: 모든 후보 실패 → candidates[0] 반환", () => {
  it("accessSync 항상 throw → 폴백으로 첫 번째 후보 반환 (L22)", async () => {
    const { resolve_web_dir } = await import("@src/dashboard/static-server.js");
    const dir = resolve_web_dir();
    expect(typeof dir).toBe("string");
    expect(dir).toContain("dist");
  });
});
