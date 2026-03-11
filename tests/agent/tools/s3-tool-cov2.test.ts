/**
 * S3Tool — 미커버 분기 (cov2):
 * - L58, L59: get + local_path → writeFile → JSON 반환
 * - L66: put + local_path → readFile → 업로드
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { S3Tool } from "@src/agent/tools/s3.js";

const CREDS = {
  bucket: "my-bucket",
  access_key: "AKIAIOSFODNN7EXAMPLE",
  secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

const tmp_dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmp_dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function make_tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "s3-cov2-"));
  tmp_dirs.push(d);
  return d;
}

function mock_ok(body: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(body, { status: 200 }),
  );
}

// ── L58, L59: get + local_path → writeFile → JSON 반환 ──────────────────────

describe("S3Tool — get + local_path → L58/L59: writeFile + JSON 반환", () => {
  it("local_path 지정 시 파일에 저장 후 JSON 반환 (L58, L59)", async () => {
    const tmp = make_tmp();
    const dest = join(tmp, "downloaded.txt");

    mock_ok("file content from S3");

    const tool = new S3Tool();
    const result = JSON.parse(await tool.execute({
      action: "get",
      ...CREDS,
      key: "my-object.txt",
      local_path: dest,
    }));

    expect(result.success).toBe(true);
    expect(result.path).toBe(dest);
    expect(typeof result.size).toBe("number");
    expect(result.size).toBeGreaterThan(0);
  });
});

// ── L66: put + local_path → readFile → 업로드 ───────────────────────────────

describe("S3Tool — put + local_path → L66: readFile 사용", () => {
  it("local_path에서 파일 읽어 업로드 (L66)", async () => {
    const tmp = make_tmp();
    const src = join(tmp, "upload.txt");
    writeFileSync(src, "upload content here");

    mock_ok("");

    const tool = new S3Tool();
    const result = JSON.parse(await tool.execute({
      action: "put",
      ...CREDS,
      key: "target/upload.txt",
      local_path: src,
    }));

    expect(result.success).toBe(true);
    expect(result.key).toBe("target/upload.txt");
    expect(result.size).toBeGreaterThan(0);
  });
});
