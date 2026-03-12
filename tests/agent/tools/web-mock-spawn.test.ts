/**
 * web.ts — 미커버 분기 (cov3):
 * - L48: extract_search_results — results.length >= count → break
 * - L50: extract_search_results — !title_match → continue (non-link lines)
 * - L52: extract_search_results — !title → continue (empty title)
 */
import { describe, it, expect, vi } from "vitest";

// ── child_process 모킹 (agent-browser 설치됨으로 인식) ────────────────────

const { mock_spawn_sync_cov3, mock_exec_file_cov3 } = vi.hoisted(() => ({
  mock_spawn_sync_cov3: vi.fn(),
  mock_exec_file_cov3: vi.fn(),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return {
    ...real,
    spawnSync: mock_spawn_sync_cov3,
    execFile: mock_exec_file_cov3,
  };
});

// 바이너리 있는 것으로 감지
mock_spawn_sync_cov3.mockReturnValue({ status: 0 });

import { WebSearchTool, WebBrowserTool } from "@src/agent/tools/web.js";

type ExecCallback = (e: Error | null, r: { stdout: string; stderr: string }) => void;

function make_snapshot_response(snapshot: string) {
  const stdout = JSON.stringify({ data: { snapshot } }) + "\n";
  mock_exec_file_cov3
    .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
    .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
    .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout, stderr: "" }));     // snapshot
}

// ── L50: 비-link 라인 → !title_match continue ────────────────────────────

describe("extract_search_results — 비-link 라인 skip (L50)", () => {
  it("non-link 텍스트 라인만 있는 snapshot → results 없음", async () => {
    // 모든 라인이 link 패턴 없음 → L50 for each line
    const snapshot = [
      "This is normal text",
      "Another line without link pattern",
      "## Header section",
      "- List item",
    ].join("\n");
    make_snapshot_response(snapshot);

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "test", count: 5 }));
    expect(r.results).toHaveLength(0);
  });
});

// ── L52: 빈 title → !title continue ──────────────────────────────────────

describe("extract_search_results — 빈 title skip (L52)", () => {
  it('link "" (빈 제목) → skip됨 (L52)', async () => {
    // link "" 패턴: title_match 성공하지만 title=""(trim 후 빈 문자열) → L52
    const snapshot = [
      `link "" [ref=r1]`,          // 빈 title → L52 skip
      `link "  " [ref=r2]`,        // 공백만 → L52 skip
      `link "Real Title" [ref=r3]`, // 유효한 title → 포함됨
    ].join("\n");
    make_snapshot_response(snapshot);

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "test", count: 5 }));
    // 빈 title 2개 skip → 1개만 포함
    expect(r.results).toHaveLength(1);
    expect(r.results[0].title).toBe("Real Title");
  });
});

// ── L268: WebBrowserTool wait — selector 없고 wait_ms NaN ────────────────

describe("WebBrowserTool — wait 유효성 검사 (L268)", () => {
  it("selector 없고 wait_ms=비숫자 → 'Error: selector or wait_ms is required' (L268)", async () => {
    const tool = new WebBrowserTool();
    // wait_ms: "abc" → Number("abc" || 0) = Number("abc") = NaN → !isFinite(NaN) = true
    // selector: "" → !selector = true → 두 조건 모두 true → L268 return
    const r = await tool.execute({ action: "wait", wait_ms: "abc" as unknown as number });
    expect(String(r)).toContain("selector or wait_ms");
  });
});

// ── L48: count 도달 시 break ───────────────────────────────────────────────

describe("extract_search_results — count 도달 break (L48)", () => {
  it("count=1 + 3개 link → 1개만 반환 (L48 break)", async () => {
    const snapshot = [
      `link "Result 1" [ref=r1]`,
      `link "Result 2" [ref=r2]`,
      `link "Result 3" [ref=r3]`,
    ].join("\n");
    make_snapshot_response(snapshot);

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "test", count: 1 }));
    // count=1 → L48 break 후 1개만 반환
    expect(r.results).toHaveLength(1);
    expect(r.results[0].title).toBe("Result 1");
  });
});
