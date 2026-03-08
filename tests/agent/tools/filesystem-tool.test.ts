/**
 * ReadFileTool / WriteFileTool / EditFileTool / ListDirTool / SearchFilesTool 커버리지.
 * 실제 temp 디렉토리 사용.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReadFileTool } from "@src/agent/tools/filesystem.js";
import { WriteFileTool } from "@src/agent/tools/filesystem.js";
import { EditFileTool } from "@src/agent/tools/filesystem.js";
import { ListDirTool } from "@src/agent/tools/filesystem.js";
import { SearchFilesTool } from "@src/agent/tools/filesystem.js";

const tmp = mkdtempSync(join(tmpdir(), "fs-tool-test-"));

// 테스트용 파일 구조 생성
writeFileSync(join(tmp, "hello.txt"), "Hello, World!\nSecond line.", "utf-8");
writeFileSync(join(tmp, "data.json"), '{"key":"value"}', "utf-8");
mkdirSync(join(tmp, "subdir"), { recursive: true });
writeFileSync(join(tmp, "subdir", "nested.ts"), "export const x = 1;", "utf-8");
writeFileSync(join(tmp, "subdir", "notes.md"), "# Notes\nSome notes here.", "utf-8");
mkdirSync(join(tmp, "empty_dir"), { recursive: true });

afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

// ══════════════════════════════════════════
// ReadFileTool
// ══════════════════════════════════════════

function make_read(allowed_dir?: string) {
  return new ReadFileTool({ workspace: tmp, allowed_dir });
}

describe("ReadFileTool — 메타데이터", () => {
  it("name = read_file", () => expect(make_read().name).toBe("read_file"));
  it("category = filesystem", () => expect(make_read().category).toBe("filesystem"));
  it("to_schema: function 형식", () => expect(make_read().to_schema().type).toBe("function"));
});

describe("ReadFileTool — 파일 읽기", () => {
  it("정상 읽기 → 파일 내용 반환", async () => {
    const r = await make_read().execute({ path: "hello.txt" });
    expect(r).toContain("Hello, World!");
  });

  it("절대 경로 → 파일 내용 반환", async () => {
    const r = await make_read().execute({ path: join(tmp, "hello.txt") });
    expect(r).toContain("Hello, World!");
  });

  it("존재하지 않는 파일 → Error 반환", async () => {
    const r = await make_read().execute({ path: "nonexistent.txt" });
    expect(r).toContain("Error");
  });

  it("디렉토리 경로 → Not a file 반환", async () => {
    const r = await make_read().execute({ path: "subdir" });
    expect(r).toContain("Error");
    expect(r).toContain("Not a file");
  });

  it("allowed_dir 밖 경로 + 미승인 → approval_required 반환", async () => {
    const restricted = make_read(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "hello.txt" });
    expect(r).toContain("approval_required");
    expect(r).toContain("__approved=true");
  });

  it("allowed_dir 밖 경로 + __approved=true → 읽기 성공", async () => {
    const restricted = make_read(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "hello.txt", __approved: true });
    expect(r).toContain("Hello, World!");
  });

  it("allowed_dir 안 경로 → 바로 읽기", async () => {
    const restricted = make_read(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "subdir/nested.ts" });
    expect(r).toContain("export const x");
  });
});

// ══════════════════════════════════════════
// WriteFileTool
// ══════════════════════════════════════════

function make_write(allowed_dir?: string) {
  return new WriteFileTool({ workspace: tmp, allowed_dir });
}

describe("WriteFileTool — 메타데이터", () => {
  it("name = write_file", () => expect(make_write().name).toBe("write_file"));
  it("category = filesystem", () => expect(make_write().category).toBe("filesystem"));
  it("policy_flags: write=true", () => expect(make_write().policy_flags.write).toBe(true));
});

describe("WriteFileTool — 파일 쓰기", () => {
  it("신규 파일 쓰기 → Wrote 반환", async () => {
    const r = await make_write().execute({ path: "new_file.txt", content: "test content" });
    expect(r).toContain("Wrote");
    expect(r).toContain("12");
  });

  it("append=true → 기존 내용에 추가", async () => {
    const tool = make_write();
    await tool.execute({ path: "append_test.txt", content: "line1" });
    await tool.execute({ path: "append_test.txt", content: "\nline2", append: true });
    const r = await make_read().execute({ path: "append_test.txt" });
    expect(r).toContain("line1");
    expect(r).toContain("line2");
  });

  it("중간 디렉토리 없음 → 자동 생성 후 쓰기", async () => {
    const r = await make_write().execute({ path: "deep/nested/file.txt", content: "deep content" });
    expect(r).toContain("Wrote");
  });

  it("allowed_dir 밖 경로 + 미승인 → approval_required 반환", async () => {
    const restricted = make_write(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "new_outside.txt", content: "x" });
    expect(r).toContain("approval_required");
  });
});

// ══════════════════════════════════════════
// EditFileTool
// ══════════════════════════════════════════

function make_edit(allowed_dir?: string) {
  return new EditFileTool({ workspace: tmp, allowed_dir });
}

describe("EditFileTool — 메타데이터", () => {
  it("name = edit_file", () => expect(make_edit().name).toBe("edit_file"));
  it("category = filesystem", () => expect(make_edit().category).toBe("filesystem"));
  it("policy_flags: write=true", () => expect(make_edit().policy_flags.write).toBe(true));
});

describe("EditFileTool — 편집", () => {
  it("정상 치환 → Edited 반환", async () => {
    const tool = make_edit();
    const write = make_write();
    await write.execute({ path: "edit_me.txt", content: "old content here" });
    const r = await tool.execute({ path: "edit_me.txt", old_text: "old content", new_text: "new content" });
    expect(r).toContain("Edited");
  });

  it("old_text 없음 → Error 반환", async () => {
    const r = await make_edit().execute({ path: "hello.txt", old_text: "NOTEXIST", new_text: "x" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });

  it("old_text 다중 출현 + replace_all 미설정 → Error 반환", async () => {
    const write = make_write();
    await write.execute({ path: "multi_edit.txt", content: "aa bb aa cc aa" });
    const r = await make_edit().execute({ path: "multi_edit.txt", old_text: "aa", new_text: "ZZ" });
    expect(r).toContain("Error");
    expect(r).toContain("3 times");
  });

  it("replace_all=true → 전체 치환 + 횟수 반환", async () => {
    const write = make_write();
    await write.execute({ path: "all_edit.txt", content: "x y x z x" });
    const r = await make_edit().execute({ path: "all_edit.txt", old_text: "x", new_text: "Q", replace_all: true });
    expect(r).toContain("Edited");
    expect(r).toContain("3 replacements");
  });

  it("allowed_dir 밖 경로 + 미승인 → approval_required 반환", async () => {
    const restricted = make_edit(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "hello.txt", old_text: "Hello", new_text: "Hi" });
    expect(r).toContain("approval_required");
  });
});

// ══════════════════════════════════════════
// ListDirTool
// ══════════════════════════════════════════

function make_list(allowed_dir?: string) {
  return new ListDirTool({ workspace: tmp, allowed_dir });
}

describe("ListDirTool — 메타데이터", () => {
  it("name = list_dir", () => expect(make_list().name).toBe("list_dir"));
  it("category = filesystem", () => expect(make_list().category).toBe("filesystem"));
});

describe("ListDirTool — 디렉토리 목록", () => {
  it("루트 디렉토리 목록 → 항목 반환", async () => {
    const r = await make_list().execute({ path: "." });
    expect(r).toContain("hello.txt");
  });

  it("파일 경로 → Not a directory 반환", async () => {
    const r = await make_list().execute({ path: "hello.txt" });
    expect(r).toContain("Error");
    expect(r).toContain("Not a directory");
  });

  it("빈 디렉토리 → (empty directory) 반환", async () => {
    const r = await make_list().execute({ path: "empty_dir" });
    expect(r).toContain("empty directory");
  });

  it("recursive=true → 하위 항목 포함", async () => {
    const r = await make_list().execute({ path: ".", recursive: true });
    expect(r).toContain("nested.ts");
    expect(r).toContain("notes.md");
  });

  it("pattern 필터 → .ts 파일만", async () => {
    const r = await make_list().execute({ path: ".", recursive: true, pattern: "*.ts" });
    expect(r).toContain("nested.ts");
    expect(r).not.toContain("notes.md");
  });

  it("limit 적용 → 제한된 항목 반환", async () => {
    const r = await make_list().execute({ path: ".", limit: 1 });
    const lines = r.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(1);
  });

  it("allowed_dir 밖 경로 + 미승인 → approval_required 반환", async () => {
    const restricted = make_list(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "." });
    expect(r).toContain("approval_required");
  });
});

// ══════════════════════════════════════════
// SearchFilesTool
// ══════════════════════════════════════════

function make_search(allowed_dir?: string) {
  return new SearchFilesTool({ workspace: tmp, allowed_dir });
}

describe("SearchFilesTool — 메타데이터", () => {
  it("name = search_files", () => expect(make_search().name).toBe("search_files"));
  it("category = filesystem", () => expect(make_search().category).toBe("filesystem"));
});

describe("SearchFilesTool — 파일 검색", () => {
  it("pattern 없음 → 전체 파일 반환", async () => {
    const r = await make_search().execute({ path: "." });
    expect(r).toContain("hello.txt");
  });

  it("*.ts 패턴 → ts 파일만", async () => {
    const r = await make_search().execute({ path: ".", pattern: "*.ts" });
    expect(r).toContain("nested.ts");
    expect(r).not.toContain("hello.txt");
  });

  it("파일 경로 → Not a directory 반환", async () => {
    const r = await make_search().execute({ path: "hello.txt" });
    expect(r).toContain("Error");
    expect(r).toContain("Not a directory");
  });

  it("content 검색 → 매칭 라인 반환", async () => {
    const r = await make_search().execute({ path: ".", content: "Hello" });
    expect(r).toContain("hello.txt");
    expect(r).toContain("Hello");
  });

  it("content 검색 없음 → No files containing 반환", async () => {
    const r = await make_search().execute({ path: ".", content: "ZZZNOMATCH" });
    expect(r).toContain("No files containing");
  });

  it("없는 패턴 → No files found 반환", async () => {
    const r = await make_search().execute({ path: ".", pattern: "*.xyz" });
    expect(r).toContain("No files found");
  });

  it("allowed_dir 밖 경로 + 미승인 → approval_required 반환", async () => {
    const restricted = make_search(join(tmp, "subdir"));
    const r = await restricted.execute({ path: "." });
    expect(r).toContain("approval_required");
  });

  it("limit 적용 → 결과 수 제한", async () => {
    const r = await make_search().execute({ path: ".", limit: 1 });
    const lines = r.trim().split("\n");
    expect(lines.length).toBe(1);
  });
});
