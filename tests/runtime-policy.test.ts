import assert from "node:assert/strict";
import test from "node:test";
import { DefaultRuntimePolicyResolver } from "../src/channels/runtime-policy.ts";

test("runtime policy escalates to full-auto for web tasks", () => {
  const resolver = new DefaultRuntimePolicyResolver();
  const policy = resolver.resolve("https://example.com 페이지 확인", []);
  assert.equal(policy.permission_profile, "full-auto");
  assert.equal(policy.command_profile, "extended");
});

test("runtime policy stays workspace-write for local-only tasks", () => {
  const resolver = new DefaultRuntimePolicyResolver();
  const policy = resolver.resolve("로컬 파일 분석", ["runtime/inbound/file.txt"]);
  assert.equal(policy.permission_profile, "workspace-write");
  assert.equal(policy.command_profile, "balanced");
});
