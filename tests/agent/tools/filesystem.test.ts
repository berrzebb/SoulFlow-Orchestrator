/**
 * filesystem tools — 미커버 분기 (cov2):
 * - L130: WriteFileTool append — 파일 없음 → readFile catch → ""로 시작
 * - L213: ListDirTool — stat throw (존재하지 않는 경로) → "Error: not found"
 * - L241: collect_entries — out.length >= limit → early return
 * - L288: SearchFilesTool — stat throw → "Error: not found"
 * - L310: content 검색 limit 초과 → break
 * - L340: find_files — depth < 0 → early return
 * - L343: find_files — out.length >= max → return
 * - L346: node_modules/.git 디렉토리 → skip
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 직접 임포트
import { WriteFileTool } from "@src/agent/tools/filesystem.js";
import { ListDirTool } from "@src/agent/tools/filesystem.js";
import { SearchFilesTool } from "@src/agent/tools/filesystem.js";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "fs-cov2-"));
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

// ── L130: append — 파일 없음 → readFile catch → "" ──────────────────────

describe("WriteFileTool — append to non-existent file (L130)", () => {
  it("존재하지 않는 파일에 append → catch→'' 후 content 쓰기 성공", async () => {
    const tool = new WriteFileTool({ workspace });
    const r = await tool.execute({
      path: join(workspace, "append-new.txt"),
      content: "first line",
      append: true,
    });
    expect(String(r)).toContain("Wrote");
  });
});

// ── L213: ListDirTool stat catch (존재하지 않는 경로) ────────────────────

describe("ListDirTool — stat catch (L213)", () => {
  it("존재하지 않는 경로 → 'Error: not found'", async () => {
    const tool = new ListDirTool({ workspace });
    const r = await tool.execute({ path: join(workspace, "nonexistent-dir-xyz") });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });
});

// ── L241: collect_entries — recursive 호출 시 out이 이미 꽉 참 ────────────
// 시나리오: limit=1, 루트에 디렉토리 1개 → 디렉토리가 out에 추가됨 → recursive 호출 → L241

describe("ListDirTool — collect_entries recursive limit (L241)", () => {
  it("limit=1, 루트에 subdir만 있을 때 → subdir 추가 후 recursive 호출에서 L241 early return", async () => {
    const sub = join(workspace, "limit-test");
    await mkdir(join(sub, "subdir"), { recursive: true });
    await writeFile(join(sub, "subdir", "c.txt"), "c");

    const tool = new ListDirTool({ workspace });
    // limit=1, recursive=true, max_depth=2
    // 1. subdir 처리: out에 "dir\tsubdir" 추가 → out.length=1=limit
    // 2. subdir은 디렉토리이므로 recursive 호출 → L241: out.length(1) >= limit(1) → return
    const r = await tool.execute({ path: sub, limit: 1, recursive: true, max_depth: 2 });
    const lines = String(r).trim().split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});

// ── L288: SearchFilesTool stat catch ────────────────────────────────────

describe("SearchFilesTool — stat catch (L288)", () => {
  it("존재하지 않는 경로 → 'Error: not found'", async () => {
    const tool = new SearchFilesTool({ workspace });
    const r = await tool.execute({ path: join(workspace, "ghost-dir"), pattern: "*.ts" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });
});

// ── L310: content 검색 limit 초과 ────────────────────────────────────────

describe("SearchFilesTool — content 검색 limit 초과 (L310)", () => {
  it("limit=2 + content 검색 → 2개 이상이면 break 후 2개 반환", async () => {
    const sub = join(workspace, "content-limit");
    await mkdir(sub, { recursive: true });
    // limit=2 이상 매치되는 파일 생성
    for (let i = 0; i < 5; i++) {
      await writeFile(join(sub, `file${i}.txt`), "MATCH_KEYWORD line here");
    }
    const tool = new SearchFilesTool({ workspace });
    const r = await tool.execute({ path: sub, content: "MATCH_KEYWORD", limit: 2 });
    const result_str = String(r);
    // "No files" 가 아니어야 함
    expect(result_str).not.toContain("No files");
    // limit=2이므로 최대 2개 파일 결과
    const matches = result_str.split("\n\n").filter(Boolean);
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

// ── L340/L343: find_files — out 가득 + depth<0 ──────────────────────────

describe("SearchFilesTool — find_files limit/depth (L340/L343)", () => {
  it("limit=1 + 파일 11개 → find_files max=10 도달 후 L343 early return", async () => {
    const sub = join(workspace, "find-limit");
    await mkdir(sub, { recursive: true });
    // limit=1 → max = limit * 10 = 10. 파일 11개 생성 → 10개 추가 후 L343 발동
    for (let i = 0; i < 11; i++) {
      await writeFile(join(sub, `file${String(i).padStart(2, "0")}.txt`), `content${i}`);
    }

    const tool = new SearchFilesTool({ workspace });
    const r = await tool.execute({ path: sub, limit: 1 });
    expect(r).toBeDefined();
    expect(String(r)).not.toContain("Error");
  });

  it("중첩 디렉토리 + max_depth=1 → 서브디렉토리 재귀 호출 시 depth<0 (L340)", async () => {
    const sub = join(workspace, "depth-limit");
    await mkdir(join(sub, "level1", "level2"), { recursive: true });
    await writeFile(join(sub, "root.txt"), "root");
    await writeFile(join(sub, "level1", "mid.txt"), "mid");
    await writeFile(join(sub, "level1", "level2", "deep.txt"), "deep");

    const tool = new SearchFilesTool({ workspace });
    // max_depth=1 → find_files(depth=1) → level1 들어가면 depth=0 → level2 들어가면 depth=-1 → L340
    const r = await tool.execute({ path: sub, max_depth: 1 });
    const result = String(r);
    expect(result).toContain("root.txt");
    // deep.txt는 depth 제한으로 포함 안 됨
    expect(result).not.toContain("deep.txt");
  });
});

// ── L346: node_modules/.git skip ────────────────────────────────────────

describe("SearchFilesTool — node_modules/.git skip (L346)", () => {
  it("node_modules 디렉토리 → skip하고 그 안 파일 제외", async () => {
    const sub = join(workspace, "nm-test");
    await mkdir(join(sub, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(sub, ".git"), { recursive: true });
    await writeFile(join(sub, "normal.txt"), "normal");
    await writeFile(join(sub, "node_modules", "pkg", "hidden.txt"), "hidden");
    await writeFile(join(sub, ".git", "config"), "config");

    const tool = new SearchFilesTool({ workspace });
    const r = await tool.execute({ path: sub, pattern: "*.txt" });
    expect(String(r)).toContain("normal.txt");
    // node_modules/pkg/hidden.txt는 skip됨
    expect(String(r)).not.toContain("hidden.txt");
  });
});
