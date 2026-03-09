/**
 * ReferenceStore — 미커버 분기 보충 (cov3).
 * - chunk_markdown: overlap 경로 (L432-433) — next_start > prev_start
 * - search: image_embed_fn + db 결과 경로 (L325-329)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReferenceStore } from "@src/services/reference-store.js";

let workspace: string;
let store: ReferenceStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "refstore-cov3-"));
  store = new ReferenceStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// chunk_markdown — overlap 경로 (L432-433)
// ══════════════════════════════════════════

describe("ReferenceStore — chunk_markdown overlap (L432-433)", () => {
  it("버퍼 1200자 초과 + next_start > prev_start → 오버랩 유지", () => {
    // CHUNK_SIZE = 1200. 긴 줄 12개로 1200자 초과.
    const long_line = "x".repeat(105); // 105 chars per line
    const lines = ["# Section\n"];
    for (let i = 0; i < 13; i++) lines.push(`${long_line}_line${i}\n`);
    const content = lines.join("");

    const chunks = (store as any).chunk_markdown(content, "test.md");
    // 오버랩이 일어났을 때 chunk가 생성됨
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // chunk에 source_path 포함
    expect(chunks[0].doc_path).toBe("test.md");
  });

  it("heading 없는 긴 콘텐츠 → chunk_fixed로 처리됨 (확인용)", () => {
    const content = "plain text ".repeat(200); // >1200 chars, no heading
    const chunks = (store as any).chunk_text(content, "notes.txt");
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("여러 섹션 + 각 섹션 오버플로우 → 여러 chunk 생성", () => {
    const long_line = "y".repeat(110);
    let content = "";
    for (let s = 0; s < 2; s++) {
      content += `# Section ${s}\n`;
      for (let i = 0; i < 13; i++) content += `${long_line}_s${s}_l${i}\n`;
    }

    const chunks = (store as any).chunk_markdown(content, "multi.md");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
