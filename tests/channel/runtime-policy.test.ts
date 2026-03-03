import { describe, it, expect } from "vitest";
import { DefaultRuntimePolicyResolver } from "@src/channels/runtime-policy.ts";

describe("runtime policy", () => {
  it("always returns full-auto sandbox — ApprovalService handles dangerous operations", () => {
    const resolver = new DefaultRuntimePolicyResolver();
    const policy = resolver.resolve("로컬 파일 분석", ["runtime/inbound/file.txt"]);
    expect(policy.sandbox.fs_access).toBe("full-access");
    expect(policy.sandbox.approval).toBe("auto-approve");
    expect(policy.sandbox.network_access).toBe(true);
  });

  it("web tasks also return full-auto sandbox", () => {
    const resolver = new DefaultRuntimePolicyResolver();
    const policy = resolver.resolve("https://example.com 페이지 확인", []);
    expect(policy.sandbox.fs_access).toBe("full-access");
    expect(policy.sandbox.approval).toBe("auto-approve");
    expect(policy.sandbox.network_access).toBe(true);
  });
});
