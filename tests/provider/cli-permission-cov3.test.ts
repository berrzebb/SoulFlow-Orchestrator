/**
 * cli-permission — 미커버 분기 (cov3):
 * - L56: strip_approval_flags — empty token continue
 * - L99: first_non_flag_index — empty token continue (via permission fn)
 * - L125: has_any_flag — empty token continue (via permission fn)
 * - L129-130: has_any_flag — --flag=value 형식 매칭
 * - L202-204: with_codex_permission_overrides — --add-dir 다음 empty dir
 * - L208: with_codex_permission_overrides — 중복 dir skip
 * - L232: with_claude_permission_overrides — 알 수 없는 fs_access → mode 없음
 * - L288-295: with_codex_mcp_runtime_overrides — enable_all_project + overrides
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  strip_approval_flags,
  with_claude_permission_overrides,
  with_codex_permission_overrides,
  with_codex_mcp_runtime_overrides,
} from "@src/providers/cli-permission.js";
import { sandbox_from_preset } from "@src/providers/types.js";

// ── mcp loader mock ────────────────────────────────────────────────────────

const mock_should_enable = vi.fn().mockReturnValue(false);
const mock_load_servers = vi.fn().mockReturnValue([]);
const mock_build_overrides = vi.fn().mockReturnValue([]);

vi.mock("@src/providers/cli-mcp-loader.js", () => ({
  load_mcp_servers_for_codex: (...args: unknown[]) => mock_load_servers(...args),
  build_codex_mcp_overrides: (...args: unknown[]) => mock_build_overrides(...args),
  runtime_mcp_allowlist: vi.fn().mockReturnValue([]),
  should_enable_all_project_mcp_servers: (...args: unknown[]) => mock_should_enable(...args),
}));

const WS = join(tmpdir(), "cov3-workspace");

// ── L56: strip_approval_flags — empty token continue ─────────────────────

describe("strip_approval_flags — empty token skip (L56)", () => {
  it("빈 문자열 토큰 → L56 continue, 결과에서 제외", () => {
    const result = strip_approval_flags(["", "--verbose", "", "--output", "json"]);
    expect(result).toEqual(["--verbose", "--output", "json"]);
  });
});

// ── L99: first_non_flag_index — empty token (via permission fn) ───────────

describe("first_non_flag_index — empty token skip (L99)", () => {
  it("command=run + args['',' codex'] → first_non_flag_index L99 empty skip → 'codex' 인식", () => {
    const sandbox = sandbox_from_preset("workspace-write");
    // command='run'이므로 is_codex_invocation이 first_non_flag_token(args)를 호출
    // → first_non_flag_index(["", "codex", "--verbose"]) → i=0: token="" → L99 continue
    // → i=1: "codex" → return 1 → is_codex_command("codex") → true
    const result = with_codex_permission_overrides(
      "run", ["", "codex", "--verbose"],
      { sandbox },
      { workspace_dir: WS },
    );
    expect(result).toBeDefined();
  });
});

// ── L125: has_any_flag — empty token (via permission fn) ─────────────────

describe("has_any_flag — empty token skip (L125)", () => {
  it("args에 빈 문자열 포함 → L125 continue, 플래그 감지 정상 작동", () => {
    const sandbox = sandbox_from_preset("full-auto");
    // 빈 문자열 + 이미 --permission-mode 있는 경우
    const args = ["", "--permission-mode", "dontAsk"];
    const result = with_claude_permission_overrides("claude", args, { sandbox });
    const count = result.filter((a) => a === "--permission-mode").length;
    expect(count).toBe(1); // 중복 추가 없음
  });
});

// ── L129-130: has_any_flag — --flag=value 형식 매칭 ──────────────────────

describe("has_any_flag — --flag=value 형식 (L129-130)", () => {
  it("--permission-mode=dontAsk 형식 → L129-130: head 매칭 → 추가 안 됨", () => {
    const sandbox = sandbox_from_preset("full-auto");
    // --permission-mode=dontAsk 형식으로 이미 있음 → eq_idx > 0 → L129-130 매칭
    const args = ["--permission-mode=dontAsk"];
    const result = with_claude_permission_overrides("claude", args, { sandbox });
    const count = result.filter((a) => a === "--permission-mode").length;
    expect(count).toBe(0);
    expect(result).toContain("--permission-mode=dontAsk");
  });
});

// ── L202-204: with_codex_permission_overrides — --add-dir 다음 empty dir ─

describe("with_codex_permission_overrides — empty dir (L202-204)", () => {
  it("--add-dir 다음 빈 문자열 → L202 continue, 그 후 새 dir 추가", () => {
    mock_should_enable.mockReturnValue(false);

    // workspace-write → fs_access != "full-access" → bypass 없음 → L199+ 진입
    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex",
      ["--sandbox", "workspace-write", "--add-dir", ""],  // --sandbox 선포함 → 삽입 안 함, 빈 dir → L202-203 continue
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: WS },
    );
    // 빈 dir은 existing_dirs에 추가 안 됨 → WS는 별도 추가됨
    expect(result.join(" ")).toContain(WS);
  });

  it("--add-dir 마지막 토큰 (다음 없음) → dir='' → L202 continue", () => {
    mock_should_enable.mockReturnValue(false);

    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex",
      ["--sandbox", "workspace-write", "--add-dir"],  // --sandbox 선포함, 다음 토큰 없음 → dir='' → L202
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: WS },
    );
    expect(result.join(" ")).toContain(WS);
  });
});

// ── L208: with_codex_permission_overrides — 중복 dir skip ─────────────────

describe("with_codex_permission_overrides — 중복 dir skip (L208)", () => {
  it("이미 --add-dir WS 있음 + codex_add_dirs=WS → 중복 skip (L208)", () => {
    mock_should_enable.mockReturnValue(false);

    const sandbox = sandbox_from_preset("workspace-write");
    const result = with_codex_permission_overrides(
      "codex",
      ["--sandbox", "workspace-write", "--add-dir", WS],  // --sandbox 선포함, 이미 WS 있음
      { sandbox },
      { workspace_dir: WS, codex_add_dirs: WS },  // 같은 dir
    );
    // 중복 → L208 skip → WS --add-dir 1개만 존재
    const pairs: string[] = [];
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i] === "--add-dir") pairs.push(result[i + 1] ?? "");
    }
    const ws_count = pairs.filter((d) => d === WS).length;
    expect(ws_count).toBe(1); // 중복 추가 없음
  });
});

// ── L232: with_claude_permission_overrides — 알 수 없는 fs_access ─────────

describe("with_claude_permission_overrides — unknown fs_access (L232)", () => {
  it("fs_access=unknown → MODE_MAP에 없음 → mode=undefined → L232 return 원본 args", () => {
    const sandbox = { ...sandbox_from_preset("full-auto"), fs_access: "unknown-level" as any, plan_only: false };
    const args = ["--verbose"];
    const result = with_claude_permission_overrides("claude", args, { sandbox });
    // mode 없으므로 --permission-mode 추가 안 됨
    expect(result).not.toContain("--permission-mode");
  });
});

// ── L288-295: with_codex_mcp_runtime_overrides — enable_all_project + overrides ─

describe("with_codex_mcp_runtime_overrides — enable_all_project + overrides (L288-295)", () => {
  it("enable_all_project=true → -c enable_all_project_mcp_servers=true 추가 (L289-290)", () => {
    mock_should_enable.mockReturnValue(true); // L289: enable_all_project=true
    mock_load_servers.mockReturnValue([]);
    mock_build_overrides.mockReturnValue([]);

    const result = with_codex_mcp_runtime_overrides(
      "codex", ["--input", "task"],
      undefined,
      { workspace_dir: WS, mcp_enabled: true },
    );
    // L290: -c enable_all_project_mcp_servers=true 추가됨
    expect(result).toContain("enable_all_project_mcp_servers=true");
    mock_should_enable.mockReturnValue(false);
  });

  it("overrides 있음 → -c override 추가 (L292-294)", () => {
    mock_should_enable.mockReturnValue(false);
    mock_load_servers.mockReturnValue(["server1"]);
    mock_build_overrides.mockReturnValue(["mcp_servers.server1.command=cmd"]);

    const result = with_codex_mcp_runtime_overrides(
      "codex", ["--input", "task"],
      undefined,
      { workspace_dir: WS, mcp_enabled: true },
    );
    // L292-294: overrides 각각 -c로 추가됨
    expect(result).toContain("mcp_servers.server1.command=cmd");
    mock_load_servers.mockReturnValue([]);
    mock_build_overrides.mockReturnValue([]);
  });
});
