/**
 * media-utils.ts — 미커버 분기 (cov2):
 * - L25: statSync.isFile() === false (디렉토리) → null
 * - L27: statSync throw → null (catch 블록)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspace: string;
let subdir: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "media-utils-cov-"));
  subdir = join(workspace, "mysubdir");
  // 하위 디렉토리 생성 (파일이 아님)
  const { mkdir } = await import("node:fs/promises");
  await mkdir(subdir, { recursive: true });
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("to_local_media_item — isFile() false (L25)", () => {
  it("디렉토리 경로 → null (L25)", async () => {
    const { to_local_media_item } = await import("@src/agent/tools/media-utils.js");
    // "./mysubdir" → resolve_local_reference → workspace/mysubdir (존재, 디렉토리)
    const result = to_local_media_item("./mysubdir", workspace);
    expect(result).toBeNull();
  });
});

describe("to_local_media_item — statSync throw (L27)", () => {
  it("statSync 예외 → null (L27)", async () => {
    vi.mock("node:fs", async (original) => {
      const actual = await original<typeof import("node:fs")>();
      return {
        ...actual,
        statSync: vi.fn().mockImplementation((p: string) => {
          if (String(p).includes("throw-test")) throw new Error("stat failed");
          return actual.statSync(p);
        }),
      };
    });
    const { to_local_media_item } = await import("@src/agent/tools/media-utils.js");
    // existsSync가 true를 반환하도록 파일 생성 후 statSync가 throw하는 경우 시뮬레이션
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(workspace, "throw-test.png"), "fake", "utf-8");
    const result = to_local_media_item("./throw-test.png", workspace);
    // statSync가 throw하면 catch → null 반환
    expect(result).toBeNull();
  });
});
