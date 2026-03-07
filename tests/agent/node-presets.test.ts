import { describe, it, expect } from "vitest";
import {
  get_preset,
  get_presets_for_type,
  get_agent_role_presets,
  build_preset_catalog,
  BUILTIN_PRESETS,
} from "@src/agent/node-presets.js";

describe("get_preset", () => {
  it("finds preset by id", () => {
    const preset = get_preset("rest-get");
    expect(preset).toBeDefined();
    expect(preset!.node_type).toBe("http");
    expect(preset!.defaults.method).toBe("GET");
  });

  it("returns undefined for unknown id", () => {
    expect(get_preset("nonexistent")).toBeUndefined();
  });
});

describe("get_presets_for_type", () => {
  it("returns all presets for a node type", () => {
    const http_presets = get_presets_for_type("http");
    expect(http_presets.length).toBeGreaterThanOrEqual(2);
    expect(http_presets.every((p) => p.node_type === "http")).toBe(true);
  });

  it("returns empty array for unknown type", () => {
    expect(get_presets_for_type("nonexistent")).toEqual([]);
  });
});

describe("get_agent_role_presets", () => {
  it("returns only ai_agent and spawn_agent presets", () => {
    const roles = get_agent_role_presets();
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((p) => p.node_type === "ai_agent" || p.node_type === "spawn_agent")).toBe(true);
  });
});

describe("build_preset_catalog", () => {
  it("builds catalog for all types", () => {
    const catalog = build_preset_catalog();
    expect(catalog).toContain("## Available Presets");
    expect(catalog).toContain("http:");
    expect(catalog).toContain("rest-get");
  });

  it("builds catalog for specific type", () => {
    const catalog = build_preset_catalog("code");
    expect(catalog).toContain("code:");
    expect(catalog).not.toContain("http:");
  });

  it("returns empty string for unknown type", () => {
    expect(build_preset_catalog("nonexistent")).toBe("");
  });
});

describe("BUILTIN_PRESETS integrity", () => {
  it("all presets have required fields", () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.node_type).toBeTruthy();
      expect(p.preset_id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(typeof p.defaults).toBe("object");
    }
  });

  it("all preset_ids are unique", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.preset_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
