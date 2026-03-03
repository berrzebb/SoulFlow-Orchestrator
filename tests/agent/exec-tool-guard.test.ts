import { describe, it, expect } from "vitest";
import { ExecTool } from "@src/agent/tools/shell.ts";

describe("exec tool guard", () => {
  it("blocks obfuscated command substitution", async () => {
    const tool = new ExecTool({ working_dir: process.cwd() });
    const output = await tool.execute({ command: "echo $(whoami)" });
    expect(String(output || "")).toMatch(/blocked by safety anti-obfuscation policy/i);
  });

  it("blocks decoded payload piped to shell", async () => {
    const tool = new ExecTool({ working_dir: process.cwd() });
    const output = await tool.execute({ command: "echo cm0gLXJmIC8= | base64 -d | bash" });
    expect(String(output || "")).toMatch(/blocked by safety deny-pattern/i);
  });
});
