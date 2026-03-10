/**
 * country / geo / jsonl / ical / json-patch 핸들러 — catch 분기 커버.
 * 각 핸들러에서 Tool.execute() throw → catch → { error: ... } 반환 검증.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/agent/tools/country.js", () => ({
  CountryTool: class { async execute() { throw new Error("country tool error"); } },
}));

vi.mock("../../../src/agent/tools/geo.js", () => ({
  GeoTool: class { async execute() { throw new Error("geo tool error"); } },
}));

vi.mock("../../../src/agent/tools/jsonl.js", () => ({
  JsonlTool: class { async execute() { throw new Error("jsonl tool error"); } },
}));

vi.mock("../../../src/agent/tools/ical.js", () => ({
  IcalTool: class { async execute() { throw new Error("ical tool error"); } },
}));

vi.mock("../../../src/agent/tools/json-patch.js", () => ({
  JsonPatchTool: class { async execute() { throw new Error("json-patch tool error"); } },
}));

import { country_handler } from "../../../src/agent/nodes/country.js";
import { geo_handler } from "../../../src/agent/nodes/geo.js";
import { jsonl_handler } from "../../../src/agent/nodes/jsonl.js";
import { ical_handler } from "../../../src/agent/nodes/ical.js";
import { json_patch_handler } from "../../../src/agent/nodes/json-patch.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

describe("노드 핸들러 catch 분기 — Tool throw", () => {
  it("country_handler: CountryTool throw → catch → error 반환 (L54)", async () => {
    const r = await country_handler.execute({ node_id: "n1", node_type: "country", action: "lookup", code: "KR" } as any, ctx);
    expect((r.output as any).error).toContain("country tool error");
  });

  it("geo_handler: GeoTool throw → catch → error 반환 (L60)", async () => {
    const r = await geo_handler.execute({ node_id: "n1", node_type: "geo", action: "distance", lat1: 1, lon1: 1, lat2: 2, lon2: 2 } as any, ctx);
    expect((r.output as any).error).toContain("geo tool error");
  });

  it("jsonl_handler: JsonlTool throw → catch → error 반환 (L54)", async () => {
    const r = await jsonl_handler.execute({ node_id: "n1", node_type: "jsonl", action: "parse", input: "{}" } as any, ctx);
    expect((r.output as any).error).toContain("jsonl tool error");
  });

  it("ical_handler: IcalTool throw → catch → error 반환 (L52)", async () => {
    const r = await ical_handler.execute({ node_id: "n1", node_type: "ical", action: "generate", events: "[]" } as any, ctx);
    expect((r.output as any).error).toContain("ical tool error");
  });

  it("json_patch_handler: JsonPatchTool throw → catch → error 반환 (L48)", async () => {
    const r = await json_patch_handler.execute({ node_id: "n1", node_type: "json_patch", action: "apply", document: "{}", patch: "[]" } as any, ctx);
    expect((r.output as any).error).toContain("json-patch tool error");
  });
});
