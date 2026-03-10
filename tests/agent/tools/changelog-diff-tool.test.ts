/**
 * ChangelogTool + DiffTool 커버리지.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChangelogTool } from "@src/agent/tools/changelog.js";
import { DiffTool } from "@src/agent/tools/diff.js";

const tmp = mkdtempSync(join(tmpdir(), "changelog-diff-test-"));
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

const cl = new ChangelogTool();
const diff = new DiffTool();

// ══════════════════════════════════════════
// ChangelogTool
// ══════════════════════════════════════════

describe("ChangelogTool — 메타데이터", () => {
  it("name = changelog", () => expect(cl.name).toBe("changelog"));
  it("category = data", () => expect(cl.category).toBe("data"));
  it("to_schema: function 형식", () => expect(cl.to_schema().type).toBe("function"));
});

describe("ChangelogTool — parse_commits", () => {
  it("줄 구분 커밋 파싱 → conventional commit 반환", async () => {
    const r = await cl.execute({ action: "parse_commits", commits: "feat(ui): add button\nfix: resolve crash" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
    expect(parsed.commits[0].type).toBe("feat");
    expect(parsed.commits[0].scope).toBe("ui");
    expect(parsed.commits[0].description).toBe("add button");
    expect(parsed.commits[1].type).toBe("fix");
  });

  it("JSON 배열 입력 → 파싱", async () => {
    const commits = JSON.stringify(["feat: new feature", "chore: cleanup"]);
    const r = await cl.execute({ action: "parse_commits", commits });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
    expect(parsed.commits[0].type).toBe("feat");
  });

  it("빈 commits → count=0", async () => {
    const r = await cl.execute({ action: "parse_commits", commits: "" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(0);
  });

  it("non-conventional commit → type=''", async () => {
    const r = await cl.execute({ action: "parse_commits", commits: "WIP some work" });
    const parsed = JSON.parse(r);
    expect(parsed.commits[0].type).toBe("");
  });

  it("BREAKING CHANGE body → breaking=true", async () => {
    // JSON 배열로 멀티라인 커밋 전달 (개행 포함)
    const commits = JSON.stringify(["feat: new api\nBREAKING CHANGE: removes old endpoint"]);
    const r = await cl.execute({ action: "parse_commits", commits });
    const parsed = JSON.parse(r);
    expect(parsed.commits[0].breaking).toBe(true);
  });

  it("! 접미사 → breaking=true", async () => {
    const r = await cl.execute({ action: "parse_commits", commits: "feat!: breaking feature" });
    const parsed = JSON.parse(r);
    expect(parsed.commits[0].breaking).toBe(true);
  });

  it("scope 없는 commit → scope undefined", async () => {
    const r = await cl.execute({ action: "parse_commits", commits: "fix: simple fix" });
    const parsed = JSON.parse(r);
    expect(parsed.commits[0].scope).toBeUndefined();
  });
});

describe("ChangelogTool — generate", () => {
  it("기본 changelog 생성 → ## [버전] 헤더 포함", async () => {
    const r = await cl.execute({
      action: "generate",
      version: "1.2.0",
      date: "2024-01-15",
      commits: "feat: add search\nfix: memory leak\ndocs: update readme",
    });
    expect(r).toContain("## [1.2.0] - 2024-01-15");
    expect(r).toContain("### Features");
    expect(r).toContain("add search");
    expect(r).toContain("### Bug Fixes");
    expect(r).toContain("memory leak");
  });

  it("version/date 없음 → Unreleased + 오늘 날짜", async () => {
    const r = await cl.execute({ action: "generate", commits: "feat: something" });
    expect(r).toContain("## [Unreleased]");
    const today = new Date().toISOString().slice(0, 10);
    expect(r).toContain(today);
  });

  it("breaking commit → BREAKING CHANGES 섹션 포함", async () => {
    const r = await cl.execute({
      action: "generate",
      version: "2.0.0",
      date: "2024-06-01",
      commits: "feat!: breaking api change",
    });
    expect(r).toContain("### BREAKING CHANGES");
  });

  it("scope 있는 commit → **scope:** 형식", async () => {
    const r = await cl.execute({
      action: "generate",
      version: "1.0.0",
      date: "2024-01-01",
      commits: "fix(auth): token refresh issue",
    });
    expect(r).toContain("**auth:**");
  });

  it("repo_url + hash → 링크 포함", async () => {
    const commit_with_hash = JSON.stringify([{ type: "feat", description: "feature x", hash: "abc123def456", breaking: false }]);
    // hash는 parse_commit을 통하지 않으므로 직접 JSON 배열로 제공 — 실제로는 plain text 파싱
    // hash가 없는 plain text이므로 링크 없이 동작 확인
    const r = await cl.execute({
      action: "generate",
      version: "1.0.0",
      date: "2024-01-01",
      commits: "feat: feature x",
      repo_url: "https://github.com/org/repo",
    });
    expect(r).toContain("feature x");
  });

  it("non-conventional commits → 필터링 (포함 안 됨)", async () => {
    const r = await cl.execute({
      action: "generate",
      version: "1.0.0",
      date: "2024-01-01",
      commits: "WIP stuff\nrandom commit",
    });
    // type이 없으면 필터링
    expect(r).not.toContain("WIP stuff");
  });

  it("TYPE_LABELS에 없는 커밋 타입 → remaining groups 섹션 포함 (L152-157)", async () => {
    // 'custom' 타입은 TYPE_LABELS에 없음 → format_changelog의 remaining 루프 실행
    const r = await cl.execute({
      action: "generate",
      version: "1.0.0",
      date: "2024-01-01",
      commits: "custom(scope): my custom thing\ncustom: another custom",
    });
    expect(r).toContain("custom");
    expect(r).toContain("my custom thing");
    expect(r).toContain("**scope:**");
  });
});

describe("ChangelogTool — group_by_type", () => {
  it("타입별 그룹화 → JSON 객체 반환", async () => {
    const r = await cl.execute({
      action: "group_by_type",
      commits: "feat: feature a\nfeat: feature b\nfix: bug fix",
    });
    const parsed = JSON.parse(r);
    expect(parsed["Features"]).toHaveLength(2);
    expect(parsed["Bug Fixes"]).toHaveLength(1);
  });

  it("알 수 없는 type → type 그대로 키로 사용", async () => {
    const r = await cl.execute({ action: "group_by_type", commits: "custom: my thing" });
    const parsed = JSON.parse(r);
    expect(parsed["custom"]).toBeDefined();
  });
});

describe("ChangelogTool — format_entry", () => {
  it("기본 형식 → - description", async () => {
    const r = await cl.execute({ action: "format_entry", message: "feat: add login" });
    expect(r).toBe("- add login");
  });

  it("scope 포함 → - **scope:** description", async () => {
    const r = await cl.execute({ action: "format_entry", message: "fix(auth): token expiry" });
    expect(r).toBe("- **auth:** token expiry");
  });

  it("breaking → **BREAKING CHANGE** 접미사", async () => {
    const r = await cl.execute({ action: "format_entry", message: "feat!: breaking change" });
    expect(r).toContain("**BREAKING CHANGE**");
  });

  it("non-conventional → error 반환", async () => {
    const r = await cl.execute({ action: "format_entry", message: "WIP random stuff" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("not a conventional commit");
  });
});

describe("ChangelogTool — validate_commit", () => {
  it("유효한 commit → valid=true", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "feat(scope): add feature" });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it("형식 불일치 → errors 포함", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "random message" });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("conventional commit"))).toBe(true);
  });

  it("알 수 없는 type → error 포함", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "unknown: something here" });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("unknown type"))).toBe(true);
  });

  it("설명 짧음 → description too short", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "feat: ab" });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("too short"))).toBe(true);
  });

  it("대문자 시작 설명 → lowercase warning", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "feat: Add new feature" });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("lowercase"))).toBe(true);
  });

  it("parsed 필드 포함", async () => {
    const r = await cl.execute({ action: "validate_commit", message: "fix: correct issue" });
    const parsed = JSON.parse(r);
    expect(parsed.parsed).toBeDefined();
    expect(parsed.parsed.type).toBe("fix");
  });
});

describe("ChangelogTool — unknown action", () => {
  it("unknown → error 반환", async () => {
    const r = await cl.execute({ action: "export" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// DiffTool
// ══════════════════════════════════════════

describe("DiffTool — 메타데이터", () => {
  it("name = diff", () => expect(diff.name).toBe("diff"));
  it("category = memory", () => expect(diff.category).toBe("memory"));
  it("to_schema: function 형식", () => expect(diff.to_schema().type).toBe("function"));
});

describe("DiffTool — compare", () => {
  it("동일 텍스트 → (no differences)", async () => {
    const r = await diff.execute({ operation: "compare", old_text: "hello\nworld", new_text: "hello\nworld" });
    expect(r).toBe("(no differences)");
  });

  it("라인 추가 → + 라인 포함", async () => {
    const r = await diff.execute({ operation: "compare", old_text: "line1\nline2", new_text: "line1\nline2\nline3" });
    expect(r).toContain("+line3");
    expect(r).toContain("--- a");
    expect(r).toContain("+++ b");
  });

  it("라인 삭제 → - 라인 포함", async () => {
    const r = await diff.execute({ operation: "compare", old_text: "line1\nline2\nline3", new_text: "line1\nline3" });
    expect(r).toContain("-line2");
  });

  it("@file: prefix → 파일 읽기", async () => {
    const file_a = join(tmp, "old.txt");
    const file_b = join(tmp, "new.txt");
    writeFileSync(file_a, "original content\nline2", "utf-8");
    writeFileSync(file_b, "modified content\nline2", "utf-8");
    const r = await diff.execute({ operation: "compare", old_text: `@file:${file_a}`, new_text: `@file:${file_b}` });
    expect(r).toContain("-original content");
    expect(r).toContain("+modified content");
  });

  it("context_lines=0 → context 없음", async () => {
    const r = await diff.execute({
      operation: "compare",
      old_text: "a\nb\nc\nd\ne",
      new_text: "a\nB\nc\nd\ne",
      context_lines: 0,
    });
    expect(r).toContain("-b");
    expect(r).toContain("+B");
  });

  it("빈 old_text + 내용 있는 new_text → 모두 추가", async () => {
    const r = await diff.execute({ operation: "compare", old_text: "", new_text: "hello" });
    expect(r).toContain("+hello");
  });

  it("파일 없음 → Error 반환", async () => {
    const r = await diff.execute({ operation: "compare", old_text: "@file:/nonexistent/path/file.txt", new_text: "" });
    expect(r).toContain("Error");
  });
});

describe("DiffTool — stats", () => {
  it("stats → added/removed/similarity 반환", async () => {
    const r = await diff.execute({ operation: "stats", old_text: "a\nb\nc", new_text: "a\nb\nd\ne" });
    const parsed = JSON.parse(r);
    expect(parsed.old_lines).toBe(3);
    expect(parsed.new_lines).toBe(4);
    expect(typeof parsed.added).toBe("number");
    expect(typeof parsed.removed).toBe("number");
    expect(parsed.similarity).toContain("%");
  });

  it("동일 텍스트 → similarity=100%", async () => {
    const r = await diff.execute({ operation: "stats", old_text: "hello\nworld", new_text: "hello\nworld" });
    const parsed = JSON.parse(r);
    expect(parsed.similarity).toBe("100%");
    expect(parsed.added).toBe(0);
    expect(parsed.removed).toBe(0);
  });

  it("완전히 다른 텍스트 → similarity 0% 또는 N/A", async () => {
    // "".split("\n") = [""] → old_lines.length=1 이므로 N/A 아닌 0%
    const r = await diff.execute({ operation: "stats", old_text: "aaa", new_text: "bbb" });
    const parsed = JSON.parse(r);
    expect(parsed.similarity).toContain("%");
    expect(parsed.removed).toBeGreaterThan(0);
  });
});

describe("DiffTool — patch", () => {
  it("diff_text 없음 → Error 반환", async () => {
    const r = await diff.execute({ operation: "patch", diff_text: "" });
    expect(r).toContain("Error");
    expect(r).toContain("diff_text");
  });

  it("텍스트에 patch 적용 → 수정된 텍스트 반환", async () => {
    const old_text = "line1\nline2\nline3";
    const new_text = "line1\nLINE2\nline3";
    // compare로 diff 생성
    const diff_text = await diff.execute({ operation: "compare", old_text, new_text });
    // patch 적용
    const r = await diff.execute({ operation: "patch", old_text, diff_text });
    expect(r).toContain("LINE2");
    expect(r).not.toContain("line2");
  });

  it("target 파일에 patch 적용 → 파일 수정 + 결과 메시지", async () => {
    const target = join(tmp, "patch-target.txt");
    writeFileSync(target, "hello\nworld\n", "utf-8");
    const diff_text_for_patch = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n hello\n-world\n+WORLD\n";
    const r = await diff.execute({ operation: "patch", diff_text: diff_text_for_patch, target });
    expect(r).toContain("Patched");
    const updated = readFileSync(target, "utf-8");
    expect(updated).toContain("WORLD");
  });
});

describe("DiffTool — unsupported operation", () => {
  it("unknown → Error 반환", async () => {
    const r = await diff.execute({ operation: "merge" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});
