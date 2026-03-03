import { describe, it, expect } from "vitest";
import { SkillsLoader } from "@src/agent/skills.ts";

describe("skills always", () => {
  it("includes just-bash and agent-browser", () => {
    const loader = new SkillsLoader(process.cwd());
    const always = loader.get_always_skills();
    expect(always.includes("just-bash")).toBe(true);
    expect(always.includes("agent-browser")).toBe(true);
  });
});
