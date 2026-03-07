import { describe, it, expect } from "vitest";
import {
  resolve_templates,
  resolve_deep,
  apply_preset,
  build_channel_req,
} from "@src/agent/orche-node-executor.js";

describe("resolve_templates", () => {
  it("replaces simple path", () => {
    expect(resolve_templates("Hello {{name}}", { name: "world" })).toBe("Hello world");
  });

  it("replaces nested dot-notation path", () => {
    const ctx = { memory: { user: { name: "Alice" } } };
    expect(resolve_templates("Hi {{memory.user.name}}", ctx)).toBe("Hi Alice");
  });

  it("replaces array index notation", () => {
    const ctx = { items: ["a", "b", "c"] };
    expect(resolve_templates("{{items[1]}}", ctx)).toBe("b");
  });

  it("returns empty string for undefined path", () => {
    expect(resolve_templates("{{missing.path}}", {})).toBe("");
  });

  it("replaces multiple templates in one string", () => {
    const ctx = { a: "1", b: "2" };
    expect(resolve_templates("{{a}}-{{b}}", ctx)).toBe("1-2");
  });

  it("converts non-string values to string", () => {
    const ctx = { count: 42, flag: true };
    expect(resolve_templates("{{count}}/{{flag}}", ctx)).toBe("42/true");
  });

  it("ignores non-matching patterns", () => {
    expect(resolve_templates("no templates here", {})).toBe("no templates here");
  });

  it("handles empty template string", () => {
    expect(resolve_templates("", {})).toBe("");
  });
});

describe("resolve_deep", () => {
  it("resolves string values", () => {
    expect(resolve_deep("{{x}}", { x: "hello" })).toBe("hello");
  });

  it("resolves nested objects recursively", () => {
    const value = { name: "{{user}}", config: { key: "{{api_key}}" } };
    const ctx = { user: "Bob", api_key: "secret" };
    const result = resolve_deep(value, ctx) as Record<string, unknown>;
    expect(result.name).toBe("Bob");
    expect((result.config as Record<string, unknown>).key).toBe("secret");
  });

  it("resolves arrays recursively", () => {
    const value = ["{{a}}", "{{b}}"];
    const ctx = { a: "1", b: "2" };
    expect(resolve_deep(value, ctx)).toEqual(["1", "2"]);
  });

  it("passes through non-string primitives", () => {
    expect(resolve_deep(42, {})).toBe(42);
    expect(resolve_deep(true, {})).toBe(true);
    expect(resolve_deep(null, {})).toBeNull();
    expect(resolve_deep(undefined, {})).toBeUndefined();
  });
});

describe("apply_preset", () => {
  it("returns node unchanged when no preset_id", () => {
    const node = { node_type: "http", url: "/api" } as any;
    expect(apply_preset(node)).toBe(node);
  });

  it("returns node unchanged when preset_id not found", () => {
    const node = { node_type: "http", preset_id: "nonexistent" } as any;
    expect(apply_preset(node)).toBe(node);
  });

  it("merges preset defaults with node overrides", () => {
    const node = { node_type: "http", preset_id: "rest-get", url: "https://example.com" } as any;
    const result = apply_preset(node) as any;
    expect(result.url).toBe("https://example.com");
    expect(result.method).toBe("GET");
    expect(result.headers).toEqual({ Accept: "application/json" });
  });

  it("node values take priority over preset defaults", () => {
    const node = { node_type: "http", preset_id: "rest-get", method: "POST" } as any;
    const result = apply_preset(node) as any;
    expect(result.method).toBe("POST");
  });

  it("ignores empty string values from node (uses preset default)", () => {
    const node = { node_type: "http", preset_id: "rest-get", method: "" } as any;
    const result = apply_preset(node) as any;
    expect(result.method).toBe("GET");
  });
});

describe("build_channel_req", () => {
  it("builds origin request using state channel/chat_id", () => {
    const state = { channel: "telegram", chat_id: "123" } as any;
    const req = build_channel_req("origin", "hello", undefined, undefined, state);
    expect(req.target).toBe("origin");
    expect(req.channel).toBe("telegram");
    expect(req.chat_id).toBe("123");
    expect(req.content).toBe("hello");
  });

  it("builds specified request using explicit channel/chat_id", () => {
    const req = build_channel_req("specified", "hi", "slack", "456");
    expect(req.target).toBe("specified");
    expect(req.channel).toBe("slack");
    expect(req.chat_id).toBe("456");
  });

  it("passes through structured and parse_mode", () => {
    const structured = { blocks: [] } as any;
    const req = build_channel_req("origin", "test", undefined, undefined, undefined, structured, "markdown");
    expect(req.structured).toBe(structured);
    expect(req.parse_mode).toBe("markdown");
  });
});
