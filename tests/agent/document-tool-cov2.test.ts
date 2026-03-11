/**
 * DocumentTool — 미커버 분기 (cov2):
 * - L225: create_xlsx — 마크다운 구분자만 있는 content → data.length=0 → 에러 반환
 * - L126/242: catch 분기 — 실제 임시 디렉토리에 쓰기 불가한 경로로 트리거
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentTool } from "@src/agent/tools/document.js";

// ── L225: create_xlsx 빈 data ─────────────────────────────────────────────────

describe("DocumentTool — L225: create_xlsx 빈 data → 에러", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "doc-cov2-")); });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("markdown 구분자만 있는 content → data=[] → L225 에러 반환", async () => {
    const tool = new DocumentTool({ workspace: dir });
    // 마크다운 테이블 구분자만 있으면 cells가 /^-+$/ 필터로 제거됨 → data=[]
    const result = await tool.execute({
      action: "create_xlsx",
      content: "| --- | --- | --- |",
      output: "test.xlsx",
    });
    expect(result).toContain("no data to create spreadsheet");
  });
});

// ── L126: create_pdf catch — workspace가 파일(디렉토리 아님)인 경우 ──────────────

describe("DocumentTool — L126: create_pdf catch 분기", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "doc-catch-")); });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("workspace 하위에 같은 이름의 파일이 이미 있어 mkdir 실패 → catch L126", async () => {
    // workspace/subdir를 파일로 만들어 놓으면, 그 subdir 안에 쓰려 할 때 실패
    const blocking_file = join(dir, "blocker");
    await writeFile(blocking_file, "I am a file, not a dir");
    // workspace = blocking_file (파일인데 디렉토리로 사용하려 함 → 하위 경로 접근 불가)
    const tool = new DocumentTool({ workspace: blocking_file });
    const result = await tool.execute({
      action: "create_pdf",
      content: "Hello",
      output: "test.pdf",
    });
    // mkdir 또는 writeFile이 실패 → catch → "Error: ..."
    expect(result).toContain("Error");
  });
});

// ── L242: create_xlsx catch — 같은 패턴 ──────────────────────────────────────

describe("DocumentTool — L242: create_xlsx catch 분기", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "doc-catch2-")); });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("workspace를 파일로 설정 → writeFile 실패 → catch L242", async () => {
    const blocking_file = join(dir, "blocker2");
    await writeFile(blocking_file, "I am a file");
    const tool = new DocumentTool({ workspace: blocking_file });
    const result = await tool.execute({
      action: "create_xlsx",
      content: "Name,Age\nAlice,30",
      output: "test.xlsx",
    });
    expect(result).toContain("Error");
  });
});
