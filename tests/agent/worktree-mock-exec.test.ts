/**
 * worktree.ts — 미커버 분기 커버리지.
 *
 * 주의: merge_worktrees의 get_worktree_diff는 Promise.all로 병렬 실행됨.
 * mock_exec_file 값 소비 순서는 실제 인터리빙 순서(a1→a2→a1→a2...)를 따름.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── mock 설정 ─────────────────────────────────────────────────────────────────

const mock_exec_file = vi.hoisted(() => vi.fn());
const mock_mkdir = vi.hoisted(() => vi.fn());
const mock_rm = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile: mock_exec_file }));
vi.mock("node:util", () => ({ promisify: (fn: unknown) => fn }));
vi.mock("node:fs/promises", () => ({ mkdir: mock_mkdir, rm: mock_rm }));

import {
  create_worktree,
  create_isolated_directory,
  merge_worktrees,
  cleanup_worktrees,
} from "@src/agent/worktree.js";

const WS = "/tmp/workspace";
const ROOT_SUCCESS = { stdout: "/tmp/workspace\n", stderr: "" };
const SUCCESS = { stdout: "", stderr: "" };

beforeEach(() => {
  // resetAllMocks: 호출 이력 + once 큐 + 구현 모두 초기화
  vi.resetAllMocks();
  mock_mkdir.mockResolvedValue(undefined);
  mock_rm.mockResolvedValue(undefined);
});

// ══════════════════════════════════════════════════════════
// create_isolated_directory
// ══════════════════════════════════════════════════════════

describe("create_isolated_directory", () => {
  it("올바른 경로로 mkdir 후 경로 반환", async () => {
    const path = await create_isolated_directory({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(mock_mkdir).toHaveBeenCalledWith(
      expect.stringContaining("a1"),
      { recursive: true },
    );
    expect(path).toContain("agents");
    expect(path).toContain("a1");
  });
});

// ══════════════════════════════════════════════════════════
// create_worktree
// ══════════════════════════════════════════════════════════

describe("create_worktree — git_root 없음", () => {
  it("git_root 실패 → null 반환", async () => {
    mock_exec_file.mockRejectedValueOnce(new Error("not a git repo"));
    const r = await create_worktree({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(r).toBeNull();
  });
});

describe("create_worktree — 정상 생성", () => {
  it("worktree 생성 성공 → WorktreeHandle 반환", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)  // git rev-parse
      .mockResolvedValueOnce(SUCCESS);      // git worktree add
    const r = await create_worktree({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(r).not.toBeNull();
    expect(r!.agent_id).toBe("a1");
    expect(r!.branch).toContain("a1");
  });
});

describe("create_worktree — already exists 분기", () => {
  it("'already exists' 오류 → 재시도 성공", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockRejectedValueOnce(new Error("fatal: already exists"))
      .mockResolvedValueOnce(SUCCESS);  // 재시도 성공
    const r = await create_worktree({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(r).not.toBeNull();
    expect(r!.agent_id).toBe("a1");
  });

  it("'already exists' 오류 → 재시도도 실패 → null", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockRejectedValueOnce(new Error("fatal: already exists"))
      .mockRejectedValueOnce(new Error("worktree in use"));
    const r = await create_worktree({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(r).toBeNull();
  });

  it("기타 오류 → null (재시도 없음)", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockRejectedValueOnce(new Error("permission denied"));
    const r = await create_worktree({ workspace: WS, workflow_id: "wf1", agent_id: "a1" });
    expect(r).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// merge_worktrees
// ══════════════════════════════════════════════════════════

describe("merge_worktrees — git_root 없음", () => {
  it("git_root 실패 → 모든 handle이 not_git_repo 오류", async () => {
    mock_exec_file.mockRejectedValueOnce(new Error("not a git repo"));
    const handles = [
      { agent_id: "a1", path: "/tmp/wt1", branch: "br1" },
      { agent_id: "a2", path: "/tmp/wt2", branch: "br2" },
    ];
    const results = await merge_worktrees(WS, handles);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.error === "not_git_repo")).toBe(true);
  });
});

describe("merge_worktrees — 빈 handles", () => {
  it("handles=[] → 빈 결과", async () => {
    mock_exec_file.mockResolvedValueOnce(ROOT_SUCCESS);
    const results = await merge_worktrees(WS, []);
    expect(results).toHaveLength(0);
  });
});

describe("merge_worktrees — files_changed=0 (no-op merge)", () => {
  it("diff 없음 → merged=true, merge 커맨드 미호출", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)               // git rev-parse
      .mockResolvedValueOnce(SUCCESS)                    // git add -A
      .mockRejectedValueOnce(new Error("nothing to commit")) // git commit (no changes)
      .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git diff → empty

    const results = await merge_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(results[0].merged).toBe(true);
    expect(results[0].files_changed).toBe(0);
  });
});

describe("merge_worktrees — 정상 병합 성공", () => {
  it("files_changed>0, merge 성공 → merged=true", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)                          // git rev-parse
      .mockResolvedValueOnce(SUCCESS)                               // git add -A
      .mockResolvedValueOnce(SUCCESS)                               // git commit
      .mockResolvedValueOnce({ stdout: "file.ts\n", stderr: "" })  // git diff → 1 file
      .mockResolvedValueOnce(SUCCESS);                              // git merge

    const results = await merge_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(results[0].merged).toBe(true);
    expect(results[0].files_changed).toBe(1);
  });
});

describe("merge_worktrees — 충돌 감지 (단일 에이전트)", () => {
  it("merge 실패 + 충돌 없음 → conflict=false, error 포함", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockResolvedValueOnce(SUCCESS)
      .mockResolvedValueOnce(SUCCESS)
      .mockResolvedValueOnce({ stdout: "unique.ts\n", stderr: "" })
      .mockRejectedValueOnce(new Error("merge failed")); // git merge 실패

    const results = await merge_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(results[0].merged).toBe(false);
    expect(results[0].conflict).toBe(false);
    expect(results[0].error).toBeTruthy();
  });
});

describe("merge_worktrees — 충돌 감지 (두 에이전트, 같은 파일)", () => {
  it("같은 파일 변경 → conflict=true인 에이전트 존재", async () => {
    // Promise.all로 병렬 실행: 인터리빙 순서 = a1.add → a2.add → a1.commit → a2.commit → a1.diff → a2.diff
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)                               // git rev-parse
      .mockResolvedValueOnce(SUCCESS)                                    // a1: git add
      .mockResolvedValueOnce(SUCCESS)                                    // a2: git add (인터리브)
      .mockResolvedValueOnce(SUCCESS)                                    // a1: git commit
      .mockResolvedValueOnce(SUCCESS)                                    // a2: git commit (인터리브)
      .mockResolvedValueOnce({ stdout: "shared.ts\n", stderr: "" })     // a1: git diff
      .mockResolvedValueOnce({ stdout: "shared.ts\nother.ts\n", stderr: "" }) // a2: git diff
      .mockRejectedValueOnce(new Error("merge conflict"))               // merge a1 → 실패
      .mockResolvedValueOnce(SUCCESS)                                    // git merge --abort
      .mockRejectedValueOnce(new Error("merge conflict"))               // merge a2 → 실패
      .mockResolvedValueOnce(SUCCESS);                                   // git merge --abort

    const results = await merge_worktrees(WS, [
      { agent_id: "a1", path: "/tmp/wt1", branch: "br1" },
      { agent_id: "a2", path: "/tmp/wt2", branch: "br2" },
    ]);
    // 충돌 파일을 가진 에이전트가 conflict=true를 받아야 함
    const conflict_count = results.filter((r) => r.conflict === true).length;
    expect(conflict_count).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════
// cleanup_worktrees
// ══════════════════════════════════════════════════════════

describe("cleanup_worktrees — git_root 없음", () => {
  it("git_root 실패 → early return", async () => {
    mock_exec_file.mockRejectedValueOnce(new Error("not a git repo"));
    await cleanup_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(mock_exec_file).toHaveBeenCalledTimes(1); // git rev-parse만
  });
});

describe("cleanup_worktrees — 정상 정리", () => {
  it("handles=[] → git_root 이후 즉시 반환", async () => {
    mock_exec_file.mockResolvedValueOnce(ROOT_SUCCESS);
    await cleanup_worktrees(WS, []);
    expect(mock_exec_file).toHaveBeenCalledTimes(1);
  });

  it("worktree remove 성공 → rm 미호출", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockResolvedValueOnce(SUCCESS)  // worktree remove
      .mockResolvedValueOnce(SUCCESS); // branch -D
    await cleanup_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(mock_rm).not.toHaveBeenCalled();
  });

  it("worktree remove 실패 → rm 호출 (force remove fallback)", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockRejectedValueOnce(new Error("worktree busy"))  // worktree remove 실패
      .mockResolvedValueOnce(SUCCESS);                     // branch -D
    await cleanup_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }]);
    expect(mock_rm).toHaveBeenCalledWith("/tmp/wt1", { recursive: true, force: true });
  });

  it("branch -D 실패 → 예외 무시 (이미 삭제됨)", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockResolvedValueOnce(SUCCESS)
      .mockRejectedValueOnce(new Error("branch not found")); // branch -D 실패
    await expect(cleanup_worktrees(WS, [{ agent_id: "a1", path: "/tmp/wt1", branch: "br1" }])).resolves.toBeUndefined();
  });

  it("다수 handles → 각각 정리", async () => {
    mock_exec_file
      .mockResolvedValueOnce(ROOT_SUCCESS)
      .mockResolvedValueOnce(SUCCESS)  // wt1: worktree remove
      .mockResolvedValueOnce(SUCCESS)  // wt1: branch -D
      .mockResolvedValueOnce(SUCCESS)  // wt2: worktree remove
      .mockResolvedValueOnce(SUCCESS); // wt2: branch -D
    await cleanup_worktrees(WS, [
      { agent_id: "a1", path: "/tmp/wt1", branch: "br1" },
      { agent_id: "a2", path: "/tmp/wt2", branch: "br2" },
    ]);
    expect(mock_exec_file).toHaveBeenCalledTimes(5);
  });
});
