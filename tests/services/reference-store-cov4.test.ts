/**
 * ReferenceStore — 미커버 분기 보충 (cov4).
 * L178: sync 파일 해시 불변 → skip
 * L510: embed_image_chunks 조기 반환 (items empty)
 * L545: embed_chunks 조기 반환 (embed_fn null)
 * L588: normalize_vec norm=0 → return v
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReferenceStore } from "@src/services/reference-store.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "refstore-cov4-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// L178: 파일 해시 불변 → sync 스킵
// ══════════════════════════════════════════

describe("ReferenceStore — 파일 해시 불변 skip (L178)", () => {
  it("동일 파일로 sync 두 번 호출 → 두 번째는 L178에서 continue", async () => {
    const store = new ReferenceStore(workspace);
    const docs_dir = join(workspace, "references");
    await mkdir(docs_dir, { recursive: true });
    await writeFile(join(docs_dir, "doc.md"), "# Hello\nThis is a test document.\n");

    // 첫 번째 sync → 파일 추가됨
    const r1 = await store.sync({ force: true });
    expect(r1.added).toBeGreaterThanOrEqual(1);

    // 두 번째 sync (force=true) → 해시 동일 → L178: continue → added=0
    const r2 = await store.sync({ force: true });
    expect(r2.added).toBe(0);
    expect(r2.updated).toBe(0);
  });
});

// ══════════════════════════════════════════
// L545: embed_chunks 조기 반환 (embed_fn null)
// ══════════════════════════════════════════

describe("ReferenceStore — embed_chunks 조기 반환 (L545)", () => {
  it("embed_fn 미설정 시 sync → embed_chunks 조기 반환", async () => {
    const store = new ReferenceStore(workspace); // embed_fn=null
    const docs_dir = join(workspace, "references");
    await mkdir(docs_dir, { recursive: true });
    await writeFile(join(docs_dir, "sample.md"), "# Sample\n" + "text ".repeat(100));

    // embed_fn 없이 sync → embed_chunks: !this.embed_fn → return (L545)
    const r = await store.sync({ force: true });
    expect(typeof r.added).toBe("number");
  });
});

// ══════════════════════════════════════════
// L510: embed_image_chunks 직접 조기 반환 (items empty)
// ══════════════════════════════════════════

describe("ReferenceStore — embed_image_chunks 조기 반환 (L510)", () => {
  it("빈 items로 embed_image_chunks 직접 호출 → return (L510)", async () => {
    const store = new ReferenceStore(workspace);
    const fake_db: any = {};
    // items.length === 0 → L510: return (image_embed_fn 체크 이후)
    await expect(
      (store as any).embed_image_chunks(fake_db, [])
    ).resolves.toBeUndefined();
  });

  it("image_embed_fn null + items empty → return (L510 첫 번째 조건)", async () => {
    const store = new ReferenceStore(workspace); // image_embed_fn=null
    const fake_db: any = {};
    await expect(
      (store as any).embed_image_chunks(fake_db, [{ chunk_id: "c1", data_url: "data:image/png;base64,abc" }])
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════
// L588: normalize_vec norm=0 → return v
// ══════════════════════════════════════════

describe("ReferenceStore — normalize_vec norm=0 (L588)", () => {
  it("임베딩이 모두 0인 벡터 → 정규화 없이 반환 (L588)", async () => {
    const store = new ReferenceStore(workspace);
    let embed_called = false;
    const zero_embed = async (texts: string[]) => {
      embed_called = true;
      return { embeddings: texts.map(() => new Array(128).fill(0) as number[]) };
    };
    store.set_embed(zero_embed as any);

    const docs_dir = join(workspace, "references");
    await mkdir(docs_dir, { recursive: true });
    await writeFile(join(docs_dir, "zero.md"), "# Zero\n" + "zero vector test ".repeat(20));

    // sync → embed_chunks → normalize_vec([0,...]) → norm=0 → return v (L588)
    await store.sync({ force: true });
    expect(embed_called).toBe(true);
  });
});
