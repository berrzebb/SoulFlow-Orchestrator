import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromiseTool } from "@src/agent/tools/promise-tool.ts";
import { PromiseService } from "@src/decision/promise.service.ts";

describe("PromiseTool", () => {
  let dir: string;
  let service: PromiseService;
  let tool: PromiseTool;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "promise-tool-test-"));
    service = new PromiseService(dir, join(dir, "promises"));
    tool = new PromiseTool(service);
  });

  async function run(params: Record<string, unknown>): Promise<string> {
    return (tool as unknown as { run(p: Record<string, unknown>): Promise<string> }).run(params);
  }

  it("list — 약속 없으면 빈 메시지", async () => {
    const result = await run({ action: "list" });
    expect(result).toContain("활성 약속 없음");
  });

  it("set → list — 약속 설정 후 목록에 표시", async () => {
    const set_result = await run({ action: "set", key: "no_swear", value: "욕설 금지" });
    expect(set_result).toContain("no_swear");
    expect(set_result).toContain("욕설 금지");

    const list_result = await run({ action: "list" });
    expect(list_result).toContain("no_swear");
    expect(list_result).toContain("욕설 금지");
  });

  it("set — key/value 없으면 에러", async () => {
    expect(await run({ action: "set", key: "", value: "" })).toContain("Error");
    expect(await run({ action: "set", key: "k" })).toContain("Error");
    expect(await run({ action: "set", value: "v" })).toContain("Error");
  });

  it("set — scope 지정", async () => {
    const result = await run({ action: "set", key: "team_rule", value: "팀 규칙", scope: "team" });
    expect(result).toContain("team");
    expect(result).toContain("team_rule");
  });

  it("get_effective — 유효 약속 반환", async () => {
    await run({ action: "set", key: "rule_a", value: "A 규칙" });
    await run({ action: "set", key: "rule_b", value: "B 규칙" });

    const result = await run({ action: "get_effective" });
    expect(result).toContain("rule_a");
    expect(result).toContain("rule_b");
  });

  it("get_effective — 비어있으면 빈 메시지", async () => {
    const result = await run({ action: "get_effective" });
    expect(result).toContain("유효 약속 없음");
  });

  it("unknown action → 에러", async () => {
    const result = await run({ action: "delete" });
    expect(result).toContain("Error");
    expect(result).toContain("delete");
  });

  it("list — limit 제한 적용", async () => {
    for (let i = 0; i < 5; i++) {
      await run({ action: "set", key: `rule-${i}`, value: `규칙 ${i}` });
    }
    const result = await run({ action: "list", limit: 2 });
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
});

describe("PromiseService.build_compact_injection", () => {
  let dir: string;
  let service: PromiseService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "promise-svc-test-"));
    service = new PromiseService(dir, join(dir, "promises"));
  });

  it("빈 상태 → 빈 문자열", async () => {
    expect(await service.build_compact_injection()).toBe("");
  });

  it("약속 존재 → PROMISES_COMPACT 헤더 + 목록", async () => {
    await service.append_promise({ scope: "global", key: "no_lie", value: "거짓말 금지", source: "user" });
    const injection = await service.build_compact_injection();
    expect(injection).toContain("# PROMISES_COMPACT");
    expect(injection).toContain("no_lie");
    expect(injection).toContain("거짓말 금지");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
});
