/**
 * 여러 도구의 unknown action 분기(default) 및 catch 분기 커버.
 */
import { describe, it, expect } from "vitest";
import { GlobMatchTool } from "@src/agent/tools/glob-match.js";
import { RobotsTxtTool } from "@src/agent/tools/robots-txt.js";
import { CspTool } from "@src/agent/tools/csp.js";
import { UserAgentTool } from "@src/agent/tools/user-agent.js";
import { AsciiArtTool } from "@src/agent/tools/ascii-art.js";
import { JsonlTool } from "@src/agent/tools/jsonl.js";
import { IpTool } from "@src/agent/tools/ip.js";
import { CookieTool } from "@src/agent/tools/cookie.js";
import { HttpHeaderTool } from "@src/agent/tools/http-header.js";
import { YamlTool } from "@src/agent/tools/yaml.js";

async function exec(tool: { execute: (p: any) => Promise<unknown> }, params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("unknown action → default 분기", () => {
  it("GlobMatchTool — unknown action → error", async () => {
    const r = await exec(new GlobMatchTool(), { action: "nonexistent_action", pattern: "*" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("RobotsTxtTool — unknown action → error", async () => {
    const r = await exec(new RobotsTxtTool(), { action: "nonexistent_action", robots_txt: "" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("CspTool — unknown action → error", async () => {
    const r = await exec(new CspTool(), { action: "nonexistent_action", policy: "" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("UserAgentTool — unknown action → error", async () => {
    const r = await exec(new UserAgentTool(), { action: "nonexistent_action", ua: "" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("AsciiArtTool — unknown action → error", async () => {
    const r = await exec(new AsciiArtTool(), { action: "nonexistent_action" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("JsonlTool — unknown action → error", async () => {
    const r = await exec(new JsonlTool(), { action: "nonexistent_action" }) as any;
    const msg = String(r.error ?? r);
    expect(msg).toMatch(/unsupported action|unknown action/i);
  });

  it("IpTool — unknown action → error", async () => {
    const r = await exec(new IpTool(), { action: "nonexistent_action", ip: "1.2.3.4" }) as any;
    const msg = String(r.error ?? r);
    expect(msg).toMatch(/unsupported action|unknown action/i);
  });

  it("CookieTool — unknown action → error", async () => {
    const r = await exec(new CookieTool(), { action: "nonexistent_action" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });

  it("HttpHeaderTool — unknown action → error", async () => {
    const r = await exec(new HttpHeaderTool(), { action: "nonexistent_action" }) as any;
    expect(r.error ?? r).toMatch(/unknown action/i);
  });
});

describe("yaml.ts — generate 오류 분기 (잘못된 JSON → catch)", () => {
  const tool = new YamlTool();

  it("generate: 잘못된 JSON → catch → Error 반환", async () => {
    const r = String(await tool.execute({ action: "generate", data: "not valid json {" }));
    expect(r).toContain("Error");
  });
});
