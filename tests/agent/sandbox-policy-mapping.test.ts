import { describe, it, expect } from "vitest";
import { sandbox_from_preset } from "@src/providers/types.ts";
import type { SandboxPolicy, SandboxPreset } from "@src/providers/types.ts";
import { sandbox_to_sdk_permission, sandbox_to_codex_policy } from "@src/agent/backends/convert.ts";

describe("sandbox_from_preset", () => {
  it("strict → read-only + no network + always-ask", () => {
    const p = sandbox_from_preset("strict");
    expect(p.fs_access).toBe("read-only");
    expect(p.network_access).toBe(false);
    expect(p.approval).toBe("always-ask");
  });

  it("workspace-write → workspace-write + network + trusted-only", () => {
    const p = sandbox_from_preset("workspace-write");
    expect(p.fs_access).toBe("workspace-write");
    expect(p.network_access).toBe(true);
    expect(p.approval).toBe("trusted-only");
  });

  it("full-auto → full-access + network + auto-approve", () => {
    const p = sandbox_from_preset("full-auto");
    expect(p.fs_access).toBe("full-access");
    expect(p.network_access).toBe(true);
    expect(p.approval).toBe("auto-approve");
  });
});

describe("sandbox_to_sdk_permission", () => {
  it("plan_only overrides fs_access", () => {
    const policy: SandboxPolicy = { fs_access: "full-access", network_access: true, approval: "auto-approve", plan_only: true };
    const result = sandbox_to_sdk_permission(policy);
    expect(result.permission_mode).toBe("plan");
    expect(result.dangerous_skip).toBe(false);
  });

  it("read-only → default", () => {
    const result = sandbox_to_sdk_permission(sandbox_from_preset("strict"));
    expect(result.permission_mode).toBe("default");
    expect(result.dangerous_skip).toBe(false);
  });

  it("workspace-write → acceptEdits", () => {
    const result = sandbox_to_sdk_permission(sandbox_from_preset("workspace-write"));
    expect(result.permission_mode).toBe("acceptEdits");
    expect(result.dangerous_skip).toBe(false);
  });

  it("full-access → bypassPermissions + dangerous_skip", () => {
    const result = sandbox_to_sdk_permission(sandbox_from_preset("full-auto"));
    expect(result.permission_mode).toBe("bypassPermissions");
    expect(result.dangerous_skip).toBe(true);
  });
});

describe("sandbox_to_codex_policy", () => {
  const CWD = "/workspace";

  it("strict preset → readOnly sandbox + unlessTrusted", () => {
    const result = sandbox_to_codex_policy(sandbox_from_preset("strict"), CWD);
    expect(result.sandbox).toBe("readOnly");
    expect(result.approval_policy).toBe("unlessTrusted");
    expect(result.turn_sandbox_policy).toBeUndefined();
  });

  it("workspace-write preset → workspaceWrite sandbox + onRequest + turn_sandbox_policy", () => {
    const result = sandbox_to_codex_policy(sandbox_from_preset("workspace-write"), CWD);
    expect(result.sandbox).toBe("workspaceWrite");
    expect(result.approval_policy).toBe("onRequest");
    expect(result.turn_sandbox_policy).toBeDefined();
    expect(result.turn_sandbox_policy!.type).toBe("workspaceWrite");
    expect(result.turn_sandbox_policy!.writableRoots).toContain(CWD);
    expect(result.turn_sandbox_policy!.networkAccess).toBe(true);
  });

  it("full-auto preset → dangerFullAccess sandbox + never", () => {
    const result = sandbox_to_codex_policy(sandbox_from_preset("full-auto"), CWD);
    expect(result.sandbox).toBe("dangerFullAccess");
    expect(result.approval_policy).toBe("never");
  });

  it("writable_roots are merged with cwd in turn_sandbox_policy", () => {
    const policy: SandboxPolicy = {
      fs_access: "workspace-write",
      network_access: true,
      approval: "auto-approve",
      writable_roots: ["/extra/dir"],
    };
    const result = sandbox_to_codex_policy(policy, CWD);
    expect(result.turn_sandbox_policy!.writableRoots).toEqual([CWD, "/extra/dir"]);
  });
});
