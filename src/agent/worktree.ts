/**
 * Git Worktree 격리 — 병렬 에이전트 파일시스템 충돌 방지.
 *
 * 에이전트별 git worktree를 생성/정리하고, Phase 완료 후 변경사항을 병합.
 */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { error_message } from "../utils/common.js";

const exec_file = promisify(execFile);

const WORKTREE_DIR = ".worktrees";

export interface WorktreeHandle {
  agent_id: string;
  path: string;
  branch: string;
}

export interface WorktreeMergeResult {
  agent_id: string;
  files_changed: number;
  merged: boolean;
  conflict: boolean;
  error?: string;
}

/** git 저장소 루트 경로를 반환. git 저장소가 아니면 null. */
async function git_root(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec_file("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** 에이전트용 git worktree 생성. */
export async function create_worktree(opts: {
  workspace: string;
  workflow_id: string;
  agent_id: string;
}): Promise<WorktreeHandle | null> {
  const root = await git_root(opts.workspace);
  if (!root) return null;

  const branch = `workflow/${opts.workflow_id}/${opts.agent_id}`;
  const worktree_base = join(root, WORKTREE_DIR);
  const worktree_path = join(worktree_base, opts.agent_id);

  await mkdir(worktree_base, { recursive: true });

  try {
    await exec_file("git", ["worktree", "add", worktree_path, "-b", branch], { cwd: root });
  } catch (err) {
    // 브랜치가 이미 존재하면 기존 브랜치 사용
    const msg = error_message(err);
    if (msg.includes("already exists")) {
      try {
        await exec_file("git", ["worktree", "add", worktree_path, branch], { cwd: root });
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  return { agent_id: opts.agent_id, path: worktree_path, branch };
}

/** 에이전트용 전용 디렉토리 생성 (worktree 없이 경량 격리). */
export async function create_isolated_directory(opts: {
  workspace: string;
  workflow_id: string;
  agent_id: string;
}): Promise<string> {
  const dir = join(opts.workspace, "workflows", opts.workflow_id, "agents", opts.agent_id);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** worktree의 변경사항(diff stat)을 수집. */
async function get_worktree_diff(handle: WorktreeHandle): Promise<{ files_changed: number; files: string[] }> {
  try {
    // 커밋되지 않은 변경사항을 자동 커밋
    await exec_file("git", ["add", "-A"], { cwd: handle.path });
    try {
      await exec_file("git", ["commit", "-m", `agent: ${handle.agent_id} work`], { cwd: handle.path });
    } catch {
      // 변경사항 없으면 커밋 실패 → 정상
    }

    const { stdout } = await exec_file(
      "git", ["diff", "--name-only", "HEAD~1..HEAD"],
      { cwd: handle.path },
    );
    const files = stdout.trim().split("\n").filter(Boolean);
    return { files_changed: files.length, files };
  } catch {
    return { files_changed: 0, files: [] };
  }
}

/** Phase 완료 후 모든 worktree를 메인 브랜치에 병합. */
export async function merge_worktrees(
  workspace: string,
  handles: WorktreeHandle[],
): Promise<WorktreeMergeResult[]> {
  const root = await git_root(workspace);
  if (!root) return handles.map((h) => ({ agent_id: h.agent_id, files_changed: 0, merged: false, conflict: false, error: "not_git_repo" }));

  const results: WorktreeMergeResult[] = [];

  // 1. 각 worktree의 diff 수집
  const diffs = await Promise.all(handles.map(async (h) => ({
    handle: h,
    diff: await get_worktree_diff(h),
  })));

  // 2. 충돌 검사: 여러 에이전트가 같은 파일을 변경했는지 확인
  const file_owners = new Map<string, string[]>();
  for (const { handle, diff } of diffs) {
    for (const file of diff.files) {
      const owners = file_owners.get(file) || [];
      owners.push(handle.agent_id);
      file_owners.set(file, owners);
    }
  }
  const conflicting_files = new Set<string>();
  for (const [file, owners] of file_owners) {
    if (owners.length > 1) conflicting_files.add(file);
  }

  // 3. 병합 실행
  for (const { handle, diff } of diffs) {
    if (diff.files_changed === 0) {
      results.push({ agent_id: handle.agent_id, files_changed: 0, merged: true, conflict: false });
      continue;
    }

    const has_conflict = diff.files.some((f) => conflicting_files.has(f));

    try {
      await exec_file("git", ["merge", handle.branch, "--no-ff", "-m", `merge: ${handle.agent_id}`], { cwd: root });
      results.push({ agent_id: handle.agent_id, files_changed: diff.files_changed, merged: true, conflict: false });
    } catch (err) {
      if (has_conflict) {
        // 충돌 → merge 중단하고 보고
        try { await exec_file("git", ["merge", "--abort"], { cwd: root }); } catch { /* noop */ }
        results.push({ agent_id: handle.agent_id, files_changed: diff.files_changed, merged: false, conflict: true, error: `conflict: ${[...conflicting_files].join(", ")}` });
      } else {
        results.push({ agent_id: handle.agent_id, files_changed: diff.files_changed, merged: false, conflict: false, error: error_message(err) });
      }
    }
  }

  return results;
}

/** worktree 정리 (브랜치 + 디렉토리). */
export async function cleanup_worktrees(
  workspace: string,
  handles: WorktreeHandle[],
): Promise<void> {
  const root = await git_root(workspace);
  if (!root) return;

  for (const handle of handles) {
    try {
      await exec_file("git", ["worktree", "remove", handle.path, "--force"], { cwd: root });
    } catch {
      // force remove directory if worktree command fails
      try { await rm(handle.path, { recursive: true, force: true }); } catch { /* noop */ }
    }
    try {
      await exec_file("git", ["branch", "-D", handle.branch], { cwd: root });
    } catch { /* 이미 삭제되었거나 병합됨 */ }
  }
}
