/**
 * Phase 3 노드 핸들러 — catch 분기 커버.
 * Tool.execute() throw → catch → { error: ... } 반환 검증.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/agent/tools/color.js", () => ({
  ColorTool: class { async execute() { throw new Error("color error"); } },
}));
vi.mock("../../../src/agent/tools/semver.js", () => ({
  SemverTool: class { async execute() { throw new Error("semver error"); } },
}));
vi.mock("../../../src/agent/tools/svg.js", () => ({
  SvgTool: class { async execute() { throw new Error("svg error"); } },
}));
vi.mock("../../../src/agent/tools/random.js", () => ({
  RandomTool: class { async execute() { throw new Error("random error"); } },
}));
vi.mock("../../../src/agent/tools/url.js", () => ({
  UrlTool: class { async execute() { throw new Error("url error"); } },
}));
vi.mock("../../../src/agent/tools/ascii-art.js", () => ({
  AsciiArtTool: class { async execute() { throw new Error("ascii-art error"); } },
}));

import { color_handler } from "../../../src/agent/nodes/color.js";
import { semver_handler } from "../../../src/agent/nodes/semver.js";
import { svg_handler } from "../../../src/agent/nodes/svg.js";
import { random_handler } from "../../../src/agent/nodes/random.js";
import { url_handler } from "../../../src/agent/nodes/url.js";
import { ascii_art_handler } from "../../../src/agent/nodes/ascii-art.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

describe("Phase 3 노드 핸들러 — catch 분기", () => {
  it("color_handler: Tool throw → catch → error", async () => {
    const r = await color_handler.execute({ node_id: "n1", node_type: "color", action: "parse", color: "#fff" } as any, ctx);
    expect((r.output as any).error).toContain("color error");
  });

  it("semver_handler: Tool throw → catch → error", async () => {
    const r = await semver_handler.execute({ node_id: "n1", node_type: "semver", action: "valid", version: "1.0.0" } as any, ctx);
    expect((r.output as any).error).toContain("semver error");
  });

  it("svg_handler: Tool throw → catch → error", async () => {
    const r = await svg_handler.execute({ node_id: "n1", node_type: "svg", action: "chart" } as any, ctx);
    expect((r.output as any).error).toContain("svg error");
  });

  it("random_handler: Tool throw → catch → error", async () => {
    const r = await random_handler.execute({ node_id: "n1", node_type: "random", action: "integer" } as any, ctx);
    expect((r.output as any).error).toContain("random error");
  });

  it("url_handler: Tool throw → catch → error", async () => {
    const r = await url_handler.execute({ node_id: "n1", node_type: "url", action: "parse", url: "https://x.com" } as any, ctx);
    expect((r.output as any).error).toContain("url error");
  });

  it("ascii_art_handler: Tool throw → catch → error + success=false", async () => {
    const r = await ascii_art_handler.execute({ node_id: "n1", node_type: "ascii_art", action: "banner", text: "hi" } as any, ctx);
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("ascii-art error");
  });
});
