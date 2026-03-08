/**
 * cli-permission — 미커버 경로 보충.
 * with_codex_permission_overrides: codex_add_dirs, writable_roots, existing --add-dir skip.
 * with_codex_mcp_runtime_overrides: mcp_enabled=false, not codex invocation.
 * split_path_list: semicolon 구분자.
 */
import { describe, it, expect, vi } from "vitest";
import {
  with_codex_permission_overrides,
  with_codex_mcp_runtime_overrides,
} from "@src/providers/cli-permission.js";
import { sandbox_from_preset } from "@src/providers/types.js";

// ── mcp loader mock (파일시스템 접근 방지) ─────────────────

vi.mock("@src/providers/cli-mcp-loader.js", () => ({
  load_mcp_servers_for_codex: vi.fn().mockReturnValue([]),
  build_codex_mcp_overrides: vi.fn().mockReturnValue([]),
  runtime_mcp_allowlist: vi.fn().mockReturnValue([]),
  should_enable_all_project_mcp_servers: vi.fn().mockReturnValue(false),
}));

const WS = "/tmp/test-workspace";

// ══════════════════════════════════════════
// with_codex_permission_overrides — codex_add_dirs
// ══════════════════════════════════════════

describe("with_codex_permission_overrides — codex_add_dirs", () => {
  it("codex_add_dirs 단일 경로 → --add-dir 추가됨", () => {
    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: "/extra/path" },
    );
    expect(result).toContain("--add-dir");
    expect(result.some(v => v.includes("extra") || v.includes("path"))).toBe(true);
  });

  it("codex_add_dirs 복수 경로(쉼표) → 두 --add-dir 추가", () => {
    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: "/dir1,/dir2" },
    );
    const add_dir_count = result.filter(v => v === "--add-dir").length;
    expect(add_dir_count).toBe(2);
  });

  it("codex_add_dirs 세미콜론 구분 → 두 --add-dir 추가", () => {
    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: "/dir1;/dir2" },
    );
    const add_dir_count = result.filter(v => v === "--add-dir").length;
    expect(add_dir_count).toBe(2);
  });

  it("codex_add_dirs 빈 문자열 → --add-dir 없음", () => {
    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: "" },
    );
    expect(result.includes("--add-dir")).toBe(false);
  });
});

// ══════════════════════════════════════════
// with_codex_permission_overrides — writable_roots
// ══════════════════════════════════════════

describe("with_codex_permission_overrides — writable_roots", () => {
  it("sandbox.writable_roots 있으면 --add-dir 추가됨", () => {
    const sandbox = {
      ...sandbox_from_preset("workspace-write"),
      writable_roots: ["/writable/dir"],
    };
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS },
    );
    expect(result).toContain("--add-dir");
  });

  it("sandbox.writable_roots 빈 배열 → --add-dir 없음 (add_dirs도 없을 때)", () => {
    const sandbox = {
      ...sandbox_from_preset("workspace-write"),
      writable_roots: [],
    };
    const result = with_codex_permission_overrides(
      "codex", [],
      { sandbox },
      { workspace_dir: WS },
    );
    expect(result.includes("--add-dir")).toBe(false);
  });
});

// ══════════════════════════════════════════
// with_codex_permission_overrides — is_codex_invocation (args 첫 번째 인자)
// ══════════════════════════════════════════

describe("with_codex_permission_overrides — args 기반 codex 감지", () => {
  it("command=node, args[0]=codex → codex 동작 적용됨", () => {
    const sandbox = sandbox_from_preset("full-auto");
    // command가 node이지만 첫 번째 non-flag arg가 "codex"이면 적용
    const result = with_codex_permission_overrides(
      "node", ["codex"],
      { sandbox },
      { workspace_dir: WS },
    );
    expect(result).toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});

// ══════════════════════════════════════════
// with_codex_mcp_runtime_overrides — 조기 반환 경로
// ══════════════════════════════════════════

describe("with_codex_mcp_runtime_overrides — 조기 반환", () => {
  it("mcp_enabled=false → args 그대로 반환", () => {
    const result = with_codex_mcp_runtime_overrides(
      "codex", ["--arg1"],
      undefined,
      { workspace_dir: WS, mcp_enabled: false },
    );
    expect(result).toEqual(["--arg1"]);
  });

  it("codex 아닌 커맨드 → args 그대로 반환", () => {
    const result = with_codex_mcp_runtime_overrides(
      "node", ["--arg1"],
      undefined,
      { workspace_dir: WS, mcp_enabled: true },
    );
    expect(result).toEqual(["--arg1"]);
  });

  it("이미 mcp_servers. 플래그 있음 → args 그대로 반환", () => {
    const result = with_codex_mcp_runtime_overrides(
      "codex", ["-c", "mcp_servers.enabled=true"],
      undefined,
      { workspace_dir: WS, mcp_enabled: true },
    );
    expect(result).toEqual(["-c", "mcp_servers.enabled=true"]);
  });

  it("workspace_dir 없음 → 에러 throw", () => {
    expect(() => with_codex_mcp_runtime_overrides(
      "codex", [],
      undefined,
      { workspace_dir: undefined, mcp_enabled: true },
    )).toThrow("workspace_dir");
  });

  it("mcp_enabled=true + servers=[] + enable_all_project=false → args 그대로", () => {
    // load_mcp_servers_for_codex 는 [] 반환 (mock), enable_all_project=false (mock)
    const result = with_codex_mcp_runtime_overrides(
      "codex", ["--input", "task"],
      undefined,
      { workspace_dir: WS, mcp_enabled: true },
    );
    // overrides 없고 enable_all_project=false → 그대로 반환
    expect(result).toEqual(["--input", "task"]);
  });
});
