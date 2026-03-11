/**
 * SkillsLoader — 미커버 분기 (cov5):
 * - L326: suggest_skills_for_text — 빈 alias → normalize_text_for_match("") = "" → if (!key) continue
 * - L333: suggest_skills_for_text — 빈 trigger → normalize_text_for_match("") = "" → if (!key) continue
 *
 * L284 (load_skills_for_context의 `if (!meta) continue`):
 *   _resolve_skill_name이 non-null을 반환할 때는 항상 merged에 존재함을 보장하므로 dead code.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsLoader } from "@src/agent/skills.service.js";
import type { SkillMetadata } from "@src/agent/skills.types.js";

const tmp_dirs: string[] = [];

afterEach(() => {
  for (const d of tmp_dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function make_workspace(): string {
  const d = mkdtempSync(join(tmpdir(), "skills-cov5-"));
  tmp_dirs.push(d);
  return d;
}

function make_loader(workspace: string): SkillsLoader {
  return new SkillsLoader(workspace, workspace);
}

function make_meta(name: string, overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    name,
    path: `/fake/${name}`,
    source: "workspace_skills",
    type: "tool",
    always: false,
    summary: "",
    aliases: [],
    triggers: [],
    tools: [],
    requirements: [],
    model: null,
    frontmatter: {},
    role: null,
    soul: null,
    heart: null,
    shared_protocols: [],
    preferred_providers: [],
    oauth: [],
    intents: [],
    file_patterns: [],
    code_patterns: [],
    checks: [],
    project_docs: false,
    ...overrides,
  };
}

// ── L326: 빈 alias → normalize_text_for_match("") = "" → if (!key) continue ──

describe("SkillsLoader.suggest_skills_for_text — L326: 빈 alias → skip", () => {
  it("aliases에 빈 문자열 포함 → normalize_text_for_match('') = '' → L326 continue", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // aliases: [""] → names = ["my-skill", ""] → "" 처리 시 L326 fire
    const meta = make_meta("my-skill", {
      aliases: [""],  // 빈 alias → key = "" → L326 if (!key) continue
      summary: "test skill",
    });
    (loader as any).merged.set("my-skill", meta);

    // suggest 실행 → 빈 alias 키를 만나 L326 fire 후 continue (에러 없음)
    const result = loader.suggest_skills_for_text("my-skill task");
    // 정상 실행 완료 (빈 alias로 인한 예외 없음)
    expect(Array.isArray(result)).toBe(true);
  });

  it("aliases 여러 개 중 일부가 빈 문자열 → 빈 것만 L326 skip, 나머지는 정상 처리", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    const meta = make_meta("code-skill", {
      aliases: ["coder", "", "dev"],  // "" → L326 skip
    });
    (loader as any).merged.set("code-skill", meta);

    const result = loader.suggest_skills_for_text("coder");
    expect(Array.isArray(result)).toBe(true);
    // "coder" alias는 정상 매칭 → "code-skill" 추천
    expect(result).toContain("code-skill");
  });
});

// ── L333: 빈 trigger → normalize_text_for_match("") = "" → if (!key) continue ─

describe("SkillsLoader.suggest_skills_for_text — L333: 빈 trigger → skip", () => {
  it("triggers에 빈 문자열 포함 → normalize_text_for_match('') = '' → L333 continue", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // triggers: [""] → key = "" → L333 if (!key) continue
    const meta = make_meta("trigger-skill", {
      triggers: [""],  // 빈 trigger → L333 fire
    });
    (loader as any).merged.set("trigger-skill", meta);

    // 에러 없이 실행 완료
    const result = loader.suggest_skills_for_text("trigger task");
    expect(Array.isArray(result)).toBe(true);
  });

  it("triggers 여러 개 중 일부 빈 문자열 → 빈 것만 L333 skip, 유효한 trigger 정상 처리", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    const meta = make_meta("report-skill", {
      triggers: ["", "보고서", ""],  // 앞뒤 빈 trigger → L333 skip, "보고서" → 정상
    });
    (loader as any).merged.set("report-skill", meta);

    const result = loader.suggest_skills_for_text("보고서 작성해줘");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("report-skill");
  });
});
