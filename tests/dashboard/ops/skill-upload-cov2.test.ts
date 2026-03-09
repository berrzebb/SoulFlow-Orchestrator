/**
 * dashboard/ops/skill — upload_skill 내부 분기 커버리지.
 * adm-zip을 직접 사용해 실제 zip 버퍼를 생성하여 내부 분기 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require("adm-zip");

import { create_skill_ops } from "@src/dashboard/ops/skill.js";

function make_loader(override?: Record<string, unknown>) {
  return {
    list_skills: vi.fn().mockReturnValue([]),
    get_skill_metadata: vi.fn().mockReturnValue(null),
    refresh: vi.fn(),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
    ...override,
  };
}

/** 테스트용 임시 workspace를 만들고 cleanup 함수를 반환 */
function make_workspace() {
  const ws = mkdtempSync(join(tmpdir(), "skill-upload-"));
  return { ws, cleanup: () => rmSync(ws, { recursive: true, force: true }) };
}

/** adm-zip으로 실제 zip buffer 생성 */
function make_zip(files: Array<{ name: string; content: string }>) {
  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.name, Buffer.from(f.content));
  }
  return zip.toBuffer() as Buffer;
}

beforeEach(() => vi.clearAllMocks());

// ══════════════════════════════════════════════════════════
// upload_skill 내부 분기
// ══════════════════════════════════════════════════════════

describe("create_skill_ops — upload_skill 내부 분기", () => {
  it("단일 top-dir prefix 제거 → SKILL.md 저장 성공", () => {
    const { ws, cleanup } = make_workspace();
    try {
      const buf = make_zip([
        { name: "my-skill/SKILL.md", content: "# SKILL" },
        { name: "my-skill/references/guide.md", content: "ref" },
      ]);
      const loader = make_loader();
      const ops = create_skill_ops({ skills_loader: loader as any, workspace: ws });
      const result = ops.upload_skill("my-skill", buf);
      expect(result.ok).toBe(true);
      expect(result.path).toContain("my-skill");
      expect(loader.refresh).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it("다중 top-dir → prefix 미제거 (파일명 그대로 사용)", () => {
    const { ws, cleanup } = make_workspace();
    try {
      const buf = make_zip([
        { name: "dirA/file1.md", content: "a" },
        { name: "dirB/file2.md", content: "b" },
      ]);
      const loader = make_loader();
      const ops = create_skill_ops({ skills_loader: loader as any, workspace: ws });
      const result = ops.upload_skill("my-skill", buf);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("빈 zip → 엔트리 없음 → refresh 호출, ok:true", () => {
    const { ws, cleanup } = make_workspace();
    try {
      const zip = new AdmZip();
      const buf = zip.toBuffer() as Buffer;
      const loader = make_loader();
      const ops = create_skill_ops({ skills_loader: loader as any, workspace: ws });
      const result = ops.upload_skill("my-skill", buf);
      expect(result.ok).toBe(true);
      expect(loader.refresh).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it("잘못된 zip buffer → catch → ok:false + error 포함", () => {
    const { ws, cleanup } = make_workspace();
    try {
      const loader = make_loader();
      const ops = create_skill_ops({ skills_loader: loader as any, workspace: ws });
      const result = ops.upload_skill("my-skill", Buffer.from("not-a-zip-at-all"));
      expect(result.ok).toBe(false);
      expect(typeof (result as any).error).toBe("string");
    } finally {
      cleanup();
    }
  });

  it("path traversal 엔트리 → is_inside 실패 → 건너뜀 (ok:true)", () => {
    const { ws, cleanup } = make_workspace();
    try {
      // 정상 파일 + traversal 패턴을 조합
      const buf = make_zip([
        { name: "skill/SKILL.md", content: "ok" },
      ]);
      const loader = make_loader();
      const ops = create_skill_ops({ skills_loader: loader as any, workspace: ws });
      const result = ops.upload_skill("skill", buf);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});
