/**
 * RuntimeAdminTool — 미커버 분기 (cov3):
 * - L40-41: walk_skill_files — stat 실패 → st=null → if (!st) continue
 * - L183: skill_list — readFile 실패 → .catch(() => "") 발동
 *
 * node:fs/promises mock으로 stat/readFile 실패 시나리오 구성.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// stat이 특정 경로에서 throw하도록, readFile도 특정 경로에서 throw하도록 mock
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn().mockImplementation(async (path: string, ...args: unknown[]) => {
      if (String(path).endsWith("broken_stat")) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return actual.stat(path, ...(args as Parameters<typeof actual.stat>));
    }),
    readFile: vi.fn().mockImplementation(async (path: unknown, ...args: unknown[]) => {
      if (String(path).endsWith("SKILL.MD") && String(path).includes("unreadable")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return actual.readFile(path as Parameters<typeof actual.readFile>[0], ...(args as any[]));
    }),
  };
});

import { RuntimeAdminTool } from "@src/agent/tools/runtime-admin.ts";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";

const tmp_dirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const d of tmp_dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function make_tool(workspace: string): RuntimeAdminTool {
  const installer = new ToolInstallerService(workspace);
  return new RuntimeAdminTool({ workspace, installer });
}

function make_workspace(): string {
  const d = mkdtempSync(join(tmpdir(), "ra-cov3-"));
  tmp_dirs.push(d);
  return d;
}

// ── L40-41: stat 실패 → st=null → if (!st) continue ────────────────────────

describe("RuntimeAdminTool — L40-41: walk_skill_files stat 실패 → skip", () => {
  it("skills 디렉토리에 stat 실패 파일 존재 → L40 catch → st=null → L41 continue", async () => {
    const ws = make_workspace();

    // 정상 SKILL.MD 디렉토리 (stat 성공)
    const normal_dir = join(ws, "skills", "normal-skill");
    mkdirSync(normal_dir, { recursive: true });
    writeFileSync(join(normal_dir, "SKILL.MD"), "---\nname: normal\n---\nContent");

    // "broken_stat" 이름 파일 → mock stat → throw → L40-41 fire
    const skills_dir = join(ws, "skills");
    writeFileSync(join(skills_dir, "broken_stat"), "content");

    const tool = make_tool(ws);
    // skill_list 실행 → walk_skill_files → broken_stat에서 stat 실패 → L40-41
    const result = JSON.parse(await tool.execute({ action: "skill_list" }));
    // 정상 skill만 반환됨 (broken_stat은 스킵됨)
    expect(Array.isArray(result)).toBe(true);
    const names = result.map((r: { name: string }) => r.name);
    expect(names).toContain("normal");
    // broken_stat은 결과에 없어야 함
    expect(names.some((n: string) => n.includes("broken_stat"))).toBe(false);
  });
});

// ── L183: readFile 실패 → .catch(() => "") → declared="" → rel name 사용 ────

describe("RuntimeAdminTool — L183: skill_list readFile 실패 → catch → ''", () => {
  it("unreadable/SKILL.MD → readFile throw → L183 catch → '' → 경로명 폴백", async () => {
    const ws = make_workspace();

    // "unreadable" 디렉토리에 SKILL.MD → mock readFile이 throw하도록 설정
    const unreadable_dir = join(ws, "skills", "unreadable");
    mkdirSync(unreadable_dir, { recursive: true });
    writeFileSync(join(unreadable_dir, "SKILL.MD"), "---\nname: secret\n---\nContent");

    const tool = make_tool(ws);
    // skill_list → walk finds SKILL.MD → readFile throws → L183 catch → "" → rel name 사용
    const result = JSON.parse(await tool.execute({ action: "skill_list" }));
    expect(Array.isArray(result)).toBe(true);
    // unreadable 스킬 → declared="" → 경로 기반 이름(unreadable) 사용
    const found = result.find((r: { name: string }) => r.name === "unreadable");
    expect(found).toBeTruthy();
  });
});
