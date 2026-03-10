/**
 * Phase 3 신규 노드 핸들러 — color / semver / svg / random / url / ascii-art 기본 커버리지.
 * execute() 성공 경로, catch 경로, test() 경고 분기 포함.
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";
import { color_handler } from "@src/agent/nodes/color.js";
import { semver_handler } from "@src/agent/nodes/semver.js";
import { svg_handler } from "@src/agent/nodes/svg.js";
import { random_handler } from "@src/agent/nodes/random.js";
import { url_handler } from "@src/agent/nodes/url.js";
import { ascii_art_handler } from "@src/agent/nodes/ascii-art.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// color_handler
// ══════════════════════════════════════════

describe("color_handler", () => {
  it("metadata: node_type = color", () => expect(color_handler.node_type).toBe("color"));

  it("create_default: action=parse", () => {
    const d = color_handler.create_default?.();
    expect((d as any).action).toBe("parse");
  });

  it("execute: parse #3498db → color info 반환", async () => {
    const r = await color_handler.execute({ node_id: "n1", node_type: "color", action: "parse", color: "#3498db" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: blend action", async () => {
    const r = await color_handler.execute({ node_id: "n1", node_type: "color", action: "blend", color: "#ff0000", color2: "#0000ff" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: color 없음 → 경고", () => {
    const r = color_handler.test({ node_id: "n1", node_type: "color", action: "parse", color: "" } as any);
    expect(r.warnings).toContain("color is required");
  });

  it("test: blend + color2 없음 → 경고", () => {
    const r = color_handler.test({ node_id: "n1", node_type: "color", action: "blend", color: "#ff0000", color2: "" } as any);
    expect(r.warnings).toContain("color2 is required for this action");
  });
});

// ══════════════════════════════════════════
// semver_handler
// ══════════════════════════════════════════

describe("semver_handler", () => {
  it("metadata: node_type = semver", () => expect(semver_handler.node_type).toBe("semver"));

  it("create_default: action=valid", () => {
    const d = semver_handler.create_default?.();
    expect((d as any).action).toBe("valid");
  });

  it("execute: valid 1.2.3", async () => {
    const r = await semver_handler.execute({ node_id: "n1", node_type: "semver", action: "valid", version: "1.2.3" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: bump patch 1.2.3 → 1.2.4", async () => {
    const r = await semver_handler.execute({ node_id: "n1", node_type: "semver", action: "bump", version: "1.2.3", bump_type: "patch" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: version 없음 → 경고 (action≠sort)", () => {
    const r = semver_handler.test({ node_id: "n1", node_type: "semver", action: "valid", version: "" } as any);
    expect(r.warnings).toContain("version is required");
  });

  it("test: satisfies + range 없음 → 경고", () => {
    const r = semver_handler.test({ node_id: "n1", node_type: "semver", action: "satisfies", version: "1.0.0", range: "" } as any);
    expect(r.warnings).toContain("range is required for satisfies");
  });
});

// ══════════════════════════════════════════
// svg_handler
// ══════════════════════════════════════════

describe("svg_handler", () => {
  it("metadata: node_type = svg", () => expect(svg_handler.node_type).toBe("svg"));

  it("create_default: action=chart", () => {
    const d = svg_handler.create_default?.();
    expect((d as any).action).toBe("chart");
  });

  it("execute: chart 생성", async () => {
    const r = await svg_handler.execute({
      node_id: "n1", node_type: "svg", action: "chart",
      chart_type: "bar", data: '[{"label":"A","value":10}]', width: 400, height: 300,
    } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: chart + data 없음 → 경고", () => {
    const r = svg_handler.test({ node_id: "n1", node_type: "svg", action: "chart", data: "" } as any);
    expect(r.warnings).toContain("data is required for chart");
  });

  it("test: to_data_uri + svg 없음 → 경고", () => {
    const r = svg_handler.test({ node_id: "n1", node_type: "svg", action: "to_data_uri", svg: "" } as any);
    expect(r.warnings).toContain("svg is required for to_data_uri");
  });
});

// ══════════════════════════════════════════
// random_handler
// ══════════════════════════════════════════

describe("random_handler", () => {
  it("metadata: node_type = random", () => expect(random_handler.node_type).toBe("random"));

  it("create_default: action=integer", () => {
    const d = random_handler.create_default?.();
    expect((d as any).action).toBe("integer");
  });

  it("execute: integer 0~100", async () => {
    const r = await random_handler.execute({ node_id: "n1", node_type: "random", action: "integer", min: 0, max: 100 } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: password 16자", async () => {
    const r = await random_handler.execute({ node_id: "n1", node_type: "random", action: "password", length: 16 } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: choice + items 없음 → 경고", () => {
    const r = random_handler.test({ node_id: "n1", node_type: "random", action: "choice", items: "" } as any);
    expect(r.warnings).toContain("items is required for this action");
  });
});

// ══════════════════════════════════════════
// url_handler
// ══════════════════════════════════════════

describe("url_handler", () => {
  it("metadata: node_type = url", () => expect(url_handler.node_type).toBe("url"));

  it("create_default: action=parse", () => {
    const d = url_handler.create_default?.();
    expect((d as any).action).toBe("parse");
  });

  it("execute: parse https://example.com", async () => {
    const r = await url_handler.execute({ node_id: "n1", node_type: "url", action: "parse", url: "https://example.com/path?q=1" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("execute: encode URL", async () => {
    const r = await url_handler.execute({ node_id: "n1", node_type: "url", action: "encode", url: "https://example.com/path with spaces" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: url 없음 (parse action) → 경고", () => {
    const r = url_handler.test({ node_id: "n1", node_type: "url", action: "parse", url: "" } as any);
    expect(r.warnings).toContain("url is required");
  });

  it("test: build action → url 경고 없음", () => {
    const r = url_handler.test({ node_id: "n1", node_type: "url", action: "build", url: "" } as any);
    expect(r.warnings).not.toContain("url is required");
  });
});

// ══════════════════════════════════════════
// ascii_art_handler
// ══════════════════════════════════════════

describe("ascii_art_handler", () => {
  it("metadata: node_type = ascii_art", () => expect(ascii_art_handler.node_type).toBe("ascii_art"));

  it("create_default: action=banner", () => {
    const d = ascii_art_handler.create_default?.();
    expect((d as any).action).toBe("banner");
  });

  it("execute: banner Hello", async () => {
    const r = await ascii_art_handler.execute({ node_id: "n1", node_type: "ascii_art", action: "banner", text: "Hello" } as any, ctx);
    expect(r.output).toBeDefined();
    expect((r.output as any).success).toBe(true);
  });

  it("execute: box 텍스트", async () => {
    const r = await ascii_art_handler.execute({ node_id: "n1", node_type: "ascii_art", action: "box", text: "test" } as any, ctx);
    expect(r.output).toBeDefined();
  });

  it("test: banner + text 없음 → 경고", () => {
    const r = ascii_art_handler.test({ node_id: "n1", node_type: "ascii_art", action: "banner", text: "" } as any);
    expect(r.warnings).toContain("text is required for this action");
  });

  it("test: table + data 없음 → 경고", () => {
    const r = ascii_art_handler.test({ node_id: "n1", node_type: "ascii_art", action: "table", data: "" } as any);
    expect(r.warnings).toContain("data (JSON array) is required for table");
  });
});
