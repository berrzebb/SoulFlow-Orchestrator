/**
 * DecisionService — append/archive/list/get_effective/build_compact/dedupe 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionService } from "@src/decision/service.js";
import type { AppendDecisionInput } from "@src/decision/types.js";

let tmp_dir: string;
let svc: DecisionService;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "decision-svc-"));
  svc = new DecisionService(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

function make_input(overrides: Partial<AppendDecisionInput> = {}): AppendDecisionInput {
  return {
    scope: "global",
    key: "test_key",
    value: "test value",
    ...overrides,
  };
}

// ── append_decision ──

describe("append_decision", () => {
  it("새 결정 삽입 → inserted", async () => {
    const result = await svc.append_decision(make_input());
    expect(result.action).toBe("inserted");
    expect(result.record.key).toBe("test_key");
    expect(result.record.status).toBe("active");
  });

  it("동일 fingerprint → deduped (active 상태 유지)", async () => {
    await svc.append_decision(make_input());
    const result = await svc.append_decision(make_input());
    expect(result.action).toBe("deduped");
  });

  it("동일 키에 유사 값 → deduped (similarity >= 0.92)", async () => {
    await svc.append_decision(make_input({ value: "use the new design" }));
    const result = await svc.append_decision(make_input({ value: "Use the new Design" }));
    expect(result.action).toBe("deduped");
  });

  it("동일 키에 다른 값 → 기존 superseded + inserted", async () => {
    await svc.append_decision(make_input({ value: "old value one" }));
    const result = await svc.append_decision(make_input({ value: "completely different new approach" }));
    expect(result.action).toBe("inserted");
    expect(result.superseded_id).toBeDefined();
  });

  it("scope_id 포함 삽입", async () => {
    const result = await svc.append_decision(
      make_input({ scope: "agent", scope_id: "agent-1", key: "style", value: "concise" })
    );
    expect(result.action).toBe("inserted");
    expect(result.record.scope_id).toBe("agent-1");
  });

  it("priority, tags, rationale 필드 보존", async () => {
    const result = await svc.append_decision(
      make_input({ priority: 0, tags: ["important", "style"], rationale: "because it matters" })
    );
    expect(result.record.priority).toBe(0);
    expect(result.record.tags).toContain("important");
    expect(result.record.rationale).toBeTruthy();
  });
});

// ── archive_decision ──

describe("archive_decision", () => {
  it("활성 결정 아카이브 → true", async () => {
    const { record } = await svc.append_decision(make_input());
    const ok = await svc.archive_decision(record.id);
    expect(ok).toBe(true);

    const records = await svc.list_decisions({ status: "active" });
    expect(records.some((r) => r.id === record.id)).toBe(false);
  });

  it("존재하지 않는 id → false", async () => {
    const ok = await svc.archive_decision("nonexistent-id");
    expect(ok).toBe(false);
  });

  it("이미 archived → false", async () => {
    const { record } = await svc.append_decision(make_input());
    await svc.archive_decision(record.id);
    const ok = await svc.archive_decision(record.id);
    expect(ok).toBe(false);
  });
});

// ── list_decisions ──

describe("list_decisions", () => {
  it("필터 없음 → 전체 반환", async () => {
    await svc.append_decision(make_input({ key: "k1", value: "v1" }));
    await svc.append_decision(make_input({ key: "k2", value: "v2 something different" }));
    const list = await svc.list_decisions();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("status 필터", async () => {
    const { record } = await svc.append_decision(make_input());
    await svc.archive_decision(record.id);
    const active = await svc.list_decisions({ status: "active" });
    const archived = await svc.list_decisions({ status: "archived" });
    expect(active.some((r) => r.id === record.id)).toBe(false);
    expect(archived.some((r) => r.id === record.id)).toBe(true);
  });

  it("scope 필터", async () => {
    await svc.append_decision(make_input({ scope: "global", key: "gk", value: "global value" }));
    await svc.append_decision(make_input({ scope: "agent", scope_id: "a1", key: "ak", value: "agent value" }));
    const globals = await svc.list_decisions({ scope: "global" });
    expect(globals.every((r) => r.scope === "global")).toBe(true);
  });

  it("key 필터", async () => {
    await svc.append_decision(make_input({ key: "font_size", value: "14px" }));
    await svc.append_decision(make_input({ key: "color_scheme", value: "dark mode" }));
    const filtered = await svc.list_decisions({ key: "font_size" });
    expect(filtered.every((r) => r.canonical_key === "font_size")).toBe(true);
  });

  it("search 필터 — 값에 포함된 단어로 검색", async () => {
    await svc.append_decision(make_input({ key: "pref", value: "always use TypeScript" }));
    await svc.append_decision(make_input({ key: "other", value: "python is fine too something" }));
    const results = await svc.list_decisions({ search: "typescript" });
    expect(results.some((r) => r.canonical_key === "pref")).toBe(true);
  });

  it("limit 적용", async () => {
    for (let i = 0; i < 5; i++) {
      await svc.append_decision(make_input({ key: `key_${i}`, value: `value_${i}_something_unique` }));
    }
    const results = await svc.list_decisions({ limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("priority_lte 필터", async () => {
    await svc.append_decision(make_input({ key: "p0key", value: "critical decision", priority: 0 }));
    await svc.append_decision(make_input({ key: "p2key", value: "low priority decision", priority: 2 }));
    const results = await svc.list_decisions({ priority_lte: 1 });
    expect(results.some((r) => r.canonical_key === "p0key")).toBe(true);
    expect(results.some((r) => r.canonical_key === "p2key")).toBe(false);
  });

  it("scope_id 필터", async () => {
    await svc.append_decision(make_input({ scope: "agent", scope_id: "agent-a", key: "ka", value: "value for a" }));
    await svc.append_decision(make_input({ scope: "agent", scope_id: "agent-b", key: "kb", value: "value for b" }));
    const results = await svc.list_decisions({ scope: "agent", scope_id: "agent-a" });
    expect(results.every((r) => r.scope_id === "agent-a")).toBe(true);
  });
});

// ── get_effective_decisions ──

describe("get_effective_decisions", () => {
  it("빈 상태 → 빈 배열", async () => {
    const result = await svc.get_effective_decisions();
    expect(result).toEqual([]);
  });

  it("글로벌 결정 포함", async () => {
    await svc.append_decision(make_input({ scope: "global", key: "lang", value: "Korean" }));
    const result = await svc.get_effective_decisions();
    expect(result.some((r) => r.canonical_key === "lang")).toBe(true);
  });

  it("agent 결정이 global 결정을 덮어씀 (같은 key)", async () => {
    await svc.append_decision(make_input({ scope: "global", key: "style", value: "formal" }));
    await svc.append_decision(
      make_input({ scope: "agent", scope_id: "bot-1", key: "style", value: "casual" })
    );
    const result = await svc.get_effective_decisions({ agent_id: "bot-1" });
    const style = result.find((r) => r.canonical_key === "style");
    expect(style?.value).toBe("casual");
  });

  it("p1_limit 적용 — P1 결정 개수 제한", async () => {
    for (let i = 0; i < 10; i++) {
      await svc.append_decision(
        make_input({ key: `pref_${i}`, value: `preference ${i} with detail`, priority: 1 })
      );
    }
    const result = await svc.get_effective_decisions({ p1_limit: 3 });
    const p1s = result.filter((r) => r.priority === 1);
    expect(p1s.length).toBeLessThanOrEqual(3);
  });

  it("include_p2=true → P2 결정 포함", async () => {
    await svc.append_decision(make_input({ key: "hint", value: "low priority hint", priority: 2 }));
    const withP2 = await svc.get_effective_decisions({ include_p2: true, p2_limit: 5 });
    const withoutP2 = await svc.get_effective_decisions();
    expect(withP2.some((r) => r.priority === 2)).toBe(true);
    expect(withoutP2.some((r) => r.priority === 2)).toBe(false);
  });

  it("P0 결정 항상 포함", async () => {
    await svc.append_decision(make_input({ key: "critical", value: "always apply this", priority: 0 }));
    const result = await svc.get_effective_decisions({ p1_limit: 0 });
    expect(result.some((r) => r.priority === 0)).toBe(true);
  });
});

// ── build_compact_injection ──

describe("build_compact_injection", () => {
  it("결정 없음 → 빈 문자열", async () => {
    const result = await svc.build_compact_injection();
    expect(result).toBe("");
  });

  it("결정 있음 → DECISIONS_COMPACT 헤더 + 라인 목록", async () => {
    await svc.append_decision(make_input({ key: "tone", value: "professional", priority: 1 }));
    const result = await svc.build_compact_injection();
    expect(result).toContain("# DECISIONS_COMPACT");
    expect(result).toContain("[P1]");
    expect(result).toContain("tone:");
  });

  it("context 전달 가능", async () => {
    await svc.append_decision(
      make_input({ scope: "agent", scope_id: "a1", key: "greeting", value: "hello", priority: 1 })
    );
    const result = await svc.build_compact_injection({ agent_id: "a1" });
    expect(result).toContain("greeting");
  });
});

// ── dedupe_decisions ──

describe("dedupe_decisions", () => {
  it("중복 없음 → removed: 0", async () => {
    await svc.append_decision(make_input({ key: "a", value: "alpha decision" }));
    await svc.append_decision(make_input({ key: "b", value: "beta decision completely different" }));
    const result = await svc.dedupe_decisions();
    expect(result.removed).toBe(0);
    expect(result.active).toBeGreaterThanOrEqual(2);
  });

  it("빈 상태 → removed: 0, active: 0", async () => {
    const result = await svc.dedupe_decisions();
    expect(result.removed).toBe(0);
    expect(result.active).toBe(0);
  });
});
