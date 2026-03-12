/**
 * media 노드 — 미커버 분기 보충 (cov2):
 * - L41: resolve_safe — 경로 순회 감지 → throw
 * - L142: format_size — bytes < 1024 → "X B"
 * - L145: format_size — bytes >= 1GB → "X.X GB"
 */
import { describe, it, expect, vi } from "vitest";
import { media_handler } from "@src/agent/nodes/media.js";
import type { MediaNodeDefinition } from "@src/agent/workflow-node.types.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

import { stat } from "node:fs/promises";

function make_node(overrides?: Partial<MediaNodeDefinition>): MediaNodeDefinition {
  return {
    node_id: "m1",
    title: "media",
    node_type: "media",
    operation: "detect_type",
    input_path: "test.png",
    output_path: "",
    target_format: "",
    mime_type: "",
    thumb_width: 200,
    thumb_height: 200,
    ...overrides,
  };
}

function make_ctx(overrides?: Record<string, unknown>) {
  return {
    memory: {},
    workspace: "/safe/workspace",
    ...overrides,
  } as any;
}

// ── L41: resolve_safe — 경로 순회 throw ──────────────────────────────────────

describe("media_handler — L41: 경로 순회 감지 throw", () => {
  it("../escape/path → resolve_safe L41 throws", async () => {
    const ctx = make_ctx({ workspace: "/safe/workspace" });
    const node = make_node({ operation: "detect_type", input_path: "../../etc/passwd" });
    const result = await media_handler.execute(node, ctx);
    // path traversal → catch → error output
    expect((result.output as any).success).toBe(false);
    expect((result.output as any).result).toContain("path traversal");
  });
});

// ── L142: format_size < 1024 → "X B" ────────────────────────────────────────

describe("media_handler — L142: format_size < 1024 bytes", () => {
  it("stat.size=512 → format_size returns '512 B' (L142)", async () => {
    (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      size: 512,
      birthtime: new Date(),
      mtime: new Date(),
    });
    const node = make_node({ operation: "extract_metadata", input_path: "small.png" });
    const result = await media_handler.execute(node, make_ctx());
    expect((result.output as any).metadata?.size_human).toBe("512 B");
  });
});

// ── L145: format_size >= 1GB → "X.X GB" ─────────────────────────────────────

describe("media_handler — L145: format_size >= 1GB", () => {
  it("stat.size=2GB → format_size returns '2.0 GB' (L145)", async () => {
    const gb2 = 2 * 1024 * 1024 * 1024;
    (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      size: gb2,
      birthtime: new Date(),
      mtime: new Date(),
    });
    const node = make_node({ operation: "extract_metadata", input_path: "huge.mp4" });
    const result = await media_handler.execute(node, make_ctx());
    expect((result.output as any).metadata?.size_human).toBe("2.0 GB");
  });
});
