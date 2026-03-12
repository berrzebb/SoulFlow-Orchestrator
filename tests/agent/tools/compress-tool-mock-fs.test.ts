/**
 * CompressTool — 미커버 분기 (cov):
 * - compress.ts L60: stat.size > MAX_FILE_SIZE → "Error: file too large"
 *
 * statSync를 mock해 size > 100MB 반환 → L60 분기 커버.
 */
import { describe, it, expect, vi } from "vitest";

const mock_stat_sync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return { ...actual, statSync: mock_stat_sync };
});

import { CompressTool } from "@src/agent/tools/compress.js";

// ── L60: 파일 크기 초과 ───────────────────────────────────────────────────────

describe("CompressTool — L60: file too large", () => {
  it("stat.size > MAX_FILE_SIZE → Error 반환 (L60)", async () => {
    const MAX_FILE_SIZE = 1024 * 1024 * 100; // 100MB
    // statSync mock: 파일 크기를 100MB 초과로 반환
    mock_stat_sync.mockReturnValue({ size: MAX_FILE_SIZE + 1, isFile: () => true });

    const tool = new CompressTool();
    const result = await tool.execute({
      operation: "compress",
      input_path: "/tmp/fake-large-file.bin",
      algorithm: "gzip",
    });
    expect(String(result)).toContain("Error");
    expect(String(result)).toContain("large");
  });
});
