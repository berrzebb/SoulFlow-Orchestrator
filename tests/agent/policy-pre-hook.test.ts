/**
 * create_policy_pre_hook — 미커버 분기 보충.
 * no-sandbox/auto-approve(allow),
 * network_access=false + network 도구(deny),
 * read-only + write 도구(ask),
 * workspace-write + exec + dangerous command(deny),
 * always-ask + write(ask),
 * trusted-only + write + dangerous(deny),
 * trusted-only + write + safe(ask).
 */
import { describe, it, expect } from "vitest";
import { create_policy_pre_hook } from "@src/agent/tools/index.js";
import type { RuntimeExecutionPolicy } from "@src/providers/types.js";

// ── 도구 레지스트리 스텁 ──────────────────────────
function make_registry_stub(flags?: { write?: boolean; network?: boolean }) {
  return {
    get: (_name: string) => flags !== undefined ? { policy_flags: flags } : null,
  } as any;
}

// ── 정책 헬퍼 ──────────────────────────────────────
function policy(sandbox: RuntimeExecutionPolicy["sandbox"]): RuntimeExecutionPolicy {
  return { sandbox } as RuntimeExecutionPolicy;
}

// ══════════════════════════════════════════
// sandbox 없음 / auto-approve → allow
// ══════════════════════════════════════════

describe("create_policy_pre_hook — sandbox 없음/auto-approve", () => {
  it("sandbox=undefined → allow", () => {
    const hook = create_policy_pre_hook(policy(undefined));
    expect(hook("exec", {})).toEqual({ permission: "allow" });
  });

  it("sandbox.approval=auto-approve → allow", () => {
    const hook = create_policy_pre_hook(policy({ fs_access: "read-only", network_access: false, approval: "auto-approve" }));
    expect(hook("write_file", {})).toEqual({ permission: "allow" });
  });
});

// ══════════════════════════════════════════
// network_access=false + network 도구 → deny
// ══════════════════════════════════════════

describe("create_policy_pre_hook — network_access=false", () => {
  it("network 도구 → deny", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "read-only", network_access: false, approval: "always-ask" }),
      make_registry_stub({ network: true }),
    );
    const result = hook("web_search", {});
    expect(result.permission).toBe("deny");
    expect(result.reason).toContain("network access disabled");
  });

  it("network=false 이지만 도구에 network 플래그 없음 → deny 아님", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "read-only", network_access: false, approval: "always-ask" }),
      make_registry_stub({ write: false, network: false }),
    );
    const result = hook("read_file", {});
    expect(result.permission).not.toBe("deny");
  });
});

// ══════════════════════════════════════════
// read-only + write 도구 → ask
// ══════════════════════════════════════════

describe("create_policy_pre_hook — read-only + write", () => {
  it("write 도구 → ask (read-only policy)", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "read-only", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("write_file", {});
    expect(result.permission).toBe("ask");
    expect(result.reason).toContain("read-only policy");
  });
});

// ══════════════════════════════════════════
// workspace-write + exec + dangerous command → deny
// ══════════════════════════════════════════

describe("create_policy_pre_hook — workspace-write dangerous command", () => {
  it("exec + 'rm -rf /data' → deny", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "workspace-write", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("exec", { command: "rm -rf /data" });
    expect(result.permission).toBe("deny");
    expect(result.reason).toContain("dangerous command");
  });

  it("exec + 'drop table users' → deny", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "workspace-write", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("exec", { command: "drop table users" });
    expect(result.permission).toBe("deny");
  });

  it("exec + safe 명령 → deny 아님 (workspace-write)", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "workspace-write", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("exec", { command: "ls -la" });
    // workspace-write에서 safe 명령 → ask (trusted-only write)
    expect(result.permission).not.toBe("deny");
  });
});

// ══════════════════════════════════════════
// always-ask + write → ask
// ══════════════════════════════════════════

describe("create_policy_pre_hook — always-ask", () => {
  it("write 도구 + always-ask → ask", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "always-ask" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("write_file", {});
    expect(result.permission).toBe("ask");
    expect(result.reason).toContain("approval required");
  });

  it("read 도구 + always-ask → allow (쓰기 아님)", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "always-ask" }),
      make_registry_stub({ write: false }),
    );
    const result = hook("read_file", {});
    expect(result.permission).toBe("allow");
  });
});

// ══════════════════════════════════════════
// trusted-only + write + dangerous → deny
// trusted-only + write + safe → ask
// ══════════════════════════════════════════

describe("create_policy_pre_hook — trusted-only", () => {
  it("exec + dangerous command + trusted-only → deny", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("exec", { command: "mkfs /dev/sda1" });
    expect(result.permission).toBe("deny");
    expect(result.reason).toContain("dangerous");
  });

  it("exec + safe command + trusted-only + write → ask", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("exec", { command: "npm install lodash" });
    expect(result.permission).toBe("ask");
    expect(result.reason).toContain("trusted-only");
  });

  it("write_file (non-exec) + trusted-only → ask", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: true }),
    );
    const result = hook("write_file", {});
    expect(result.permission).toBe("ask");
  });

  it("read 도구 + trusted-only → allow (쓰기 아님)", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "full-access", network_access: true, approval: "trusted-only" }),
      make_registry_stub({ write: false }),
    );
    const result = hook("read_file", {});
    expect(result.permission).toBe("allow");
  });
});

// ══════════════════════════════════════════
// registry 없음 (flags=null)
// ══════════════════════════════════════════

describe("create_policy_pre_hook — registry=null", () => {
  it("registry 없어도 network=false + network 도구 아님 → allow", () => {
    const hook = create_policy_pre_hook(
      policy({ fs_access: "read-only", network_access: false, approval: "trusted-only" }),
      null,
    );
    // registry 없으면 flags=undefined → network=false → deny 안 됨 (tool 없으므로 is_network=false)
    const result = hook("any_tool", {});
    expect(result.permission).toBe("allow");
  });
});
