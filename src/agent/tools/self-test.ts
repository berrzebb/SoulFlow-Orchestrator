import type { ToolRegistry } from "./registry.js";

export type ToolSelfTestCase = {
  params: Record<string, unknown>;
  expect_includes?: string[];
};

export class ToolSelfTestService {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async run(tool_name: string, cases: ToolSelfTestCase[]): Promise<{ ok: boolean; results: string[] }> {
    const results: string[] = [];
    let ok = true;
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      const output = await this.registry.execute(tool_name, c.params);
      let pass = !output.startsWith("Error:");
      const checks = c.expect_includes || [];
      for (const needle of checks) {
        if (!output.includes(needle)) pass = false;
      }
      if (!pass) ok = false;
      results.push(`case#${i + 1}:${pass ? "pass" : "fail"} output=${output.slice(0, 240)}`);
    }
    return { ok, results };
  }
}
