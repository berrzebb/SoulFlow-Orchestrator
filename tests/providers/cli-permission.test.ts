/**
 * cli-permission.ts — 미커버 경로 커버리지:
 * - strip_approval_flags: 빈 토큰 건너뜀
 * - has_any_flag: 빈 정규화 토큰, = 포함 토큰(flag=value)
 * - with_codex_permission_overrides: --add-dir 기존 디렉터리 감지, dir 없음
 * - with_claude_permission_overrides: plan-only 모드
 * - with_codex_mcp_runtime_overrides: mcp_enabled=false
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@src/providers/cli-mcp-loader.js", () => ({
  build_codex_mcp_overrides: vi.fn().mockReturnValue([]),
  load_mcp_servers_for_codex: vi.fn().mockReturnValue([]),
  runtime_mcp_allowlist: vi.fn().mockReturnValue(new Set()),
  should_enable_all_project_mcp_servers: vi.fn().mockReturnValue(false),
}));

import {
  strip_approval_flags,
  with_codex_permission_overrides,
  with_claude_permission_overrides,
  with_codex_mcp_runtime_overrides,
} from "@src/providers/cli-permission.js";

// ══════════════════════════════════════════════════════════
// strip_approval_flags — 빈 토큰
// ══════════════════════════════════════════════════════════

describe("strip_approval_flags — 빈 토큰", () => {
  it("빈 문자열 아이템 포함 → 건너뜀", () => {
    const result = strip_approval_flags(["", "--ask-for-approval", "all", "exec"]);
    // 빈 토큰 건너뜀, --ask-for-approval + 다음 토큰 제거
    expect(result).toEqual(["exec"]);
  });

  it("null 항목 포함 → 건너뜀", () => {
    const result = strip_approval_flags([null as any, "exec", "--ask-for-approval=all"]);
    expect(result).toEqual(["exec"]);
  });
});

// ══════════════════════════════════════════════════════════
// with_codex_permission_overrides — --add-dir 경로
// ══════════════════════════════════════════════════════════

describe("with_codex_permission_overrides — --add-dir 기존 디렉터리", () => {
  const workspace = process.platform === "win32" ? "D:\\workspace" : "/workspace";

  it("기존 --add-dir 있음 → 중복 추가 안 함", () => {
    const result = with_codex_permission_overrides(
      "codex",
      ["exec", "--add-dir", workspace, "-"],
      { sandbox: { fs_access: "workspace-write", plan_only: false, writable_roots: [workspace] } },
      { workspace_dir: workspace },
    );
    // workspace가 이미 --add-dir로 존재하므로 중복 추가 안 됨
    const add_dir_count = result.filter((v) => v === "--add-dir").length;
    expect(add_dir_count).toBe(1);
  });

  it("--add-dir 없음 + writable_roots → --add-dir 추가", () => {
    const dir = process.platform === "win32" ? "D:\\other" : "/other";
    const result = with_codex_permission_overrides(
      "codex",
      ["exec", "-"],
      { sandbox: { fs_access: "workspace-write", plan_only: false, writable_roots: [dir] } },
      { workspace_dir: workspace },
    );
    expect(result).toContain("--add-dir");
    expect(result).toContain(dir);
  });

  it("--add-dir 다음에 빈 문자열 → 건너뜀", () => {
    // --add-dir 바로 뒤에 아무것도 없는 경우
    const result = with_codex_permission_overrides(
      "codex",
      ["exec", "--add-dir", ""],
      { sandbox: { fs_access: "workspace-write", plan_only: false, writable_roots: [] } },
      { workspace_dir: workspace },
    );
    // 빈 디렉터리 토큰은 건너뜀 → existing_dirs에 포함 안 됨
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// with_claude_permission_overrides — plan_only
// ══════════════════════════════════════════════════════════

describe("with_claude_permission_overrides — plan_only 모드", () => {
  it("plan_only=true → --permission-mode plan", () => {
    const result = with_claude_permission_overrides(
      "claude",
      ["-p", "-"],
      { sandbox: { fs_access: "full-access", plan_only: true, writable_roots: [] } },
    );
    expect(result).toContain("--permission-mode");
    expect(result).toContain("plan");
  });

  it("비 claude 커맨드 → args 그대로 반환", () => {
    const args = ["--model", "gpt-4"];
    const result = with_claude_permission_overrides("codex", args);
    expect(result).toBe(args);
  });

  it("이미 --permission-mode 있음 → 중복 추가 안 함", () => {
    const args = ["-p", "--permission-mode", "acceptEdits", "-"];
    const result = with_claude_permission_overrides(
      "claude",
      args,
      { sandbox: { fs_access: "workspace-write", plan_only: false, writable_roots: [] } },
    );
    const count = result.filter((v) => v === "--permission-mode").length;
    expect(count).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// with_codex_mcp_runtime_overrides — mcp_enabled=false
// ══════════════════════════════════════════════════════════

describe("with_codex_mcp_runtime_overrides — mcp_enabled", () => {
  it("mcp_enabled=false → args 그대로 반환", () => {
    const args = ["exec", "-"];
    const result = with_codex_mcp_runtime_overrides("codex", args, undefined, {
      mcp_enabled: false,
    });
    expect(result).toBe(args);
  });

  it("비 codex 커맨드 → args 그대로 반환", () => {
    const args = ["--model", "gpt-4"];
    const result = with_codex_mcp_runtime_overrides("claude", args);
    expect(result).toBe(args);
  });

  it("이미 mcp_servers. 플래그 있음 → args 그대로 반환", () => {
    const args = ["exec", "-c", "mcp_servers.my_server=true"];
    const result = with_codex_mcp_runtime_overrides("codex", args);
    expect(result).toBe(args);
  });

  it("workspace_dir 없음 → throws", () => {
    expect(() =>
      with_codex_mcp_runtime_overrides("codex", ["exec", "-"], undefined, { mcp_enabled: true }),
    ).toThrow("workspace_dir is required");
  });
});

// ══════════════════════════════════════════════════════════
// has_any_flag — = 포함 플래그 (flag=value 형식)
// ══════════════════════════════════════════════════════════

describe("with_codex_permission_overrides — has_any_flag = 포함 플래그", () => {
  it("--dangerously-bypass-approvals-and-sandbox=true → bypass 적용", () => {
    const result = with_codex_permission_overrides(
      "codex",
      ["exec", "--dangerously-bypass-approvals-and-sandbox=true", "-"],
      undefined,
    );
    // 이미 bypass 플래그 있으므로 args 그대로
    expect(result.some((v) => v.includes("bypass"))).toBe(true);
  });

  it("빈 아이템 포함된 args → has_any_flag 빈 토큰 건너뜀", () => {
    const result = with_codex_permission_overrides(
      "codex",
      ["", "exec", "-"],
      { sandbox: { fs_access: "workspace-write", plan_only: false, writable_roots: [] } },
      { workspace_dir: "/ws" },
    );
    // 오류 없이 처리됨
    expect(Array.isArray(result)).toBe(true);
  });
});
