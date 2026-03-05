import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  create_worktree,
  create_isolated_directory,
  merge_worktrees,
  cleanup_worktrees,
  type WorktreeHandle,
} from "../../src/agent/worktree.js";

const exec = promisify(execFile);

/** 테스트용 임시 git 저장소를 생성. */
async function make_test_repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worktree-test-"));
  await exec("git", ["init", "--initial-branch=main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# Test repo\n");
  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "initial"], { cwd: dir });
  return dir;
}

describe("Worktree — git worktree 격리", () => {
  let repo_dir: string;

  beforeEach(async () => {
    repo_dir = await make_test_repo();
  });

  afterEach(async () => {
    await rm(repo_dir, { recursive: true, force: true });
  });

  it("create_worktree: git worktree와 브랜치를 생성한다", async () => {
    const handle = await create_worktree({
      workspace: repo_dir,
      workflow_id: "wf-1",
      agent_id: "analyst",
    });

    expect(handle).not.toBeNull();
    expect(handle!.agent_id).toBe("analyst");
    expect(handle!.branch).toBe("workflow/wf-1/analyst");
    expect(handle!.path).toContain("analyst");

    // worktree에서 파일이 접근 가능한지 확인
    const readme = await readFile(join(handle!.path, "README.md"), "utf-8");
    expect(readme).toContain("# Test repo");

    await cleanup_worktrees(repo_dir, [handle!]);
  });

  it("create_worktree: git 저장소가 아니면 null을 반환한다", async () => {
    const non_git = await mkdtemp(join(tmpdir(), "non-git-"));
    const handle = await create_worktree({
      workspace: non_git,
      workflow_id: "wf-1",
      agent_id: "agent",
    });
    expect(handle).toBeNull();
    await rm(non_git, { recursive: true, force: true });
  });

  it("create_isolated_directory: 전용 디렉토리를 생성한다", async () => {
    const dir = await create_isolated_directory({
      workspace: repo_dir,
      workflow_id: "wf-2",
      agent_id: "writer",
    });

    expect(dir).toContain("writer");
    // 디렉토리가 존재하는지 확인 (파일 쓰기 가능)
    await writeFile(join(dir, "output.txt"), "test output");
    const content = await readFile(join(dir, "output.txt"), "utf-8");
    expect(content).toBe("test output");
  });

  it("merge_worktrees: 충돌 없는 변경사항을 자동 병합한다", async () => {
    // 2개 에이전트가 서로 다른 파일을 수정
    const h1 = await create_worktree({ workspace: repo_dir, workflow_id: "wf-3", agent_id: "agent-a" });
    const h2 = await create_worktree({ workspace: repo_dir, workflow_id: "wf-3", agent_id: "agent-b" });
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();

    await writeFile(join(h1!.path, "file-a.txt"), "written by agent-a\n");
    await writeFile(join(h2!.path, "file-b.txt"), "written by agent-b\n");

    const results = await merge_worktrees(repo_dir, [h1!, h2!]);

    expect(results).toHaveLength(2);
    const merged_count = results.filter((r) => r.merged).length;
    expect(merged_count).toBe(2);
    expect(results.every((r) => !r.conflict)).toBe(true);

    // main 브랜치에 두 파일이 모두 존재하는지 확인
    const fa = await readFile(join(repo_dir, "file-a.txt"), "utf-8");
    const fb = await readFile(join(repo_dir, "file-b.txt"), "utf-8");
    expect(fa).toContain("agent-a");
    expect(fb).toContain("agent-b");

    await cleanup_worktrees(repo_dir, [h1!, h2!]);
  });

  it("merge_worktrees: 같은 파일을 수정하면 충돌을 감지한다", async () => {
    const h1 = await create_worktree({ workspace: repo_dir, workflow_id: "wf-4", agent_id: "writer-1" });
    const h2 = await create_worktree({ workspace: repo_dir, workflow_id: "wf-4", agent_id: "writer-2" });
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();

    // 둘 다 README.md를 수정
    await writeFile(join(h1!.path, "README.md"), "# Modified by writer-1\n");
    await writeFile(join(h2!.path, "README.md"), "# Modified by writer-2\n");

    const results = await merge_worktrees(repo_dir, [h1!, h2!]);

    // 첫 번째는 성공, 두 번째는 충돌
    expect(results).toHaveLength(2);
    const conflicts = results.filter((r) => r.conflict);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0].error).toContain("README.md");

    await cleanup_worktrees(repo_dir, [h1!, h2!]);
  });

  it("merge_worktrees: 변경사항 없는 worktree는 merged=true, files_changed=0", async () => {
    const h = await create_worktree({ workspace: repo_dir, workflow_id: "wf-5", agent_id: "reader" });
    expect(h).not.toBeNull();

    // 아무 변경 없이 병합
    const results = await merge_worktrees(repo_dir, [h!]);
    expect(results).toHaveLength(1);
    expect(results[0].merged).toBe(true);
    expect(results[0].files_changed).toBe(0);

    await cleanup_worktrees(repo_dir, [h!]);
  });

  it("cleanup_worktrees: worktree와 브랜치를 정리한다", async () => {
    const h = await create_worktree({ workspace: repo_dir, workflow_id: "wf-6", agent_id: "temp" });
    expect(h).not.toBeNull();

    await cleanup_worktrees(repo_dir, [h!]);

    // 브랜치가 삭제되었는지 확인
    const { stdout } = await exec("git", ["branch"], { cwd: repo_dir });
    expect(stdout).not.toContain("workflow/wf-6/temp");
  });
});
