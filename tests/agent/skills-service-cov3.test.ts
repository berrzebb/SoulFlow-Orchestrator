/**
 * SkillsLoader.suggest_skills_for_text — 동일 점수 tiebreak (L387-388).
 * 두 스킬이 동일 점수 → a.name.localeCompare(b.name) 경로 커버.
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillsLoader } from "@src/agent/skills.service.js";

let workspace: string;

async function write_skill(skills_root: string, name: string, fm: string, body: string): Promise<void> {
  const dir = join(skills_root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${fm}\n---\n${body}`);
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "skills-cov3-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// L387-388: suggest_skills_for_text — 동일 점수 tiebreak
// ══════════════════════════════════════════

describe("SkillsLoader.suggest_skills_for_text — 동일 점수 tiebreak (L387-388)", () => {
  it("동일 trigger 가진 두 스킬 → 점수 동점 → 이름 알파벳순 정렬 (L388)", async () => {
    const skills_root = join(workspace, "skills");

    // 두 스킬에 동일한 trigger "helper" 설정 → 검색 시 동점
    await write_skill(skills_root, "beta-skill", "name: beta-skill\ntriggers:\n- helper", "Beta 스킬 내용");
    await write_skill(skills_root, "alpha-skill", "name: alpha-skill\ntriggers:\n- helper", "Alpha 스킬 내용");

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("helper query", 10);

    // 두 스킬 모두 반환되어야 하고, 동점이므로 알파벳순 정렬 (L388)
    expect(results.length).toBeGreaterThanOrEqual(2);
    const alpha_idx = results.indexOf("alpha-skill");
    const beta_idx = results.indexOf("beta-skill");
    expect(alpha_idx).toBeGreaterThanOrEqual(0);
    expect(beta_idx).toBeGreaterThanOrEqual(0);
    // alpha < beta → alpha가 먼저
    expect(alpha_idx).toBeLessThan(beta_idx);
  });
});
