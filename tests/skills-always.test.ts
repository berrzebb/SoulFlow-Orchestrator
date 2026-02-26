import assert from "node:assert/strict";
import test from "node:test";
import { SkillsLoader } from "../src/agent/skills.ts";

test("always skills include just-bash and agent-browser", () => {
  const loader = new SkillsLoader(process.cwd());
  const always = loader.get_always_skills();
  assert.equal(always.includes("just-bash"), true);
  assert.equal(always.includes("agent-browser"), true);
});
