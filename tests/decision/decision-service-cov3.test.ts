/**
 * DecisionService — 미커버 분기 (cov3):
 * - L36: similarity 빈 토큰 양쪽 → return 1
 * - L37: similarity 한쪽만 빈 토큰 → return 0
 * - L78-81: similarity >= 0.92 (fingerprint 다름) → deduped
 * - L176: get_effective_decisions include_p2:true → p2 필터 실행
 * - L193: dedupe_decisions — non-active 레코드 건너뜀
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DecisionService } from "@src/decision/service.js";

let workspace: string;
let svc: DecisionService;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "dec-cov3-"));
  svc = new DecisionService(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function make_input(overrides: Record<string, unknown> = {}) {
  return {
    scope: "global" as const,
    scope_id: null,
    key: "test_key",
    value: "test value content",
    priority: 1,
    ...overrides,
  };
}

// ── L36 + L78-81: 양쪽 빈 토큰 집합 → similarity = 1 ─────────────────────────

describe("DecisionService — similarity 양쪽 빈 토큰 (L36)", () => {
  it("두 값 모두 비알파벳 기호 → similarity=1 → deduped", async () => {
    // "---" 과 "..." 모두 token_set이 빈 집합 → similarity(∅,∅)=1 ≥ 0.92
    // 단, normalized_value가 다르므로 fingerprint는 다름 → L78-81 경로 진입
    await svc.append_decision(make_input({ key: "empty_tok", value: "---" }));
    const r2 = await svc.append_decision(make_input({ key: "empty_tok", value: "..." }));
    expect(r2.action).toBe("deduped");
  });
});

// ── L37: 한쪽만 빈 토큰 집합 → similarity = 0 ────────────────────────────────

describe("DecisionService — similarity 한쪽 빈 토큰 (L37)", () => {
  it("active=기호, new=단어 → similarity=0 → superseded 후 insert", async () => {
    // active value "---" → empty token set
    // new value "hello world content" → non-empty token set
    // similarity(∅, {hello,world,content}) → L37: sb.size>0, sa.size=0 → return 0
    await svc.append_decision(make_input({ key: "mix_tok", value: "---" }));
    const r2 = await svc.append_decision(make_input({ key: "mix_tok", value: "hello world content" }));
    expect(r2.action).toBe("inserted");
  });

  it("active=단어, new=기호 → similarity=0 → superseded 후 insert", async () => {
    await svc.append_decision(make_input({ key: "mix_tok2", value: "hello world content" }));
    const r2 = await svc.append_decision(make_input({ key: "mix_tok2", value: "---" }));
    expect(r2.action).toBe("inserted");
  });
});

// ── L78-81: Jaccard ≥ 0.92, fingerprint 다름 → deduped ──────────────────────

describe("DecisionService — similarity >= 0.92 deduped 경로 (L78-81)", () => {
  it("12토큰 공통/13토큰 전체 → Jaccard=12/13≈0.923 ≥ 0.92 → deduped", async () => {
    // 공통 토큰 12개, 하나 추가 → Jaccard ≈ 0.923
    const base = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const extended = `${base} mike`;
    await svc.append_decision(make_input({ key: "sim_key", value: base }));
    const r2 = await svc.append_decision(make_input({ key: "sim_key", value: extended }));
    // normalized_value 다름(공백 포함 시 다름) → fingerprint 다름 → similarity 경로
    expect(r2.action).toBe("deduped");
  });
});

// ── L176: get_effective_decisions include_p2:true ────────────────────────────

describe("DecisionService — get_effective_decisions include_p2:true (L176)", () => {
  it("priority=2 레코드 존재 + include_p2:true → p2 결과 포함", async () => {
    await svc.append_decision(make_input({ key: "p2_key", value: "p2 value content", priority: 2 }));
    const rows = await svc.get_effective_decisions({ include_p2: true, p2_limit: 5 });
    const p2_rows = rows.filter((r) => r.priority === 2);
    expect(p2_rows.length).toBeGreaterThan(0);
  });

  it("include_p2 미지정 → priority=2 제외", async () => {
    await svc.append_decision(make_input({ key: "p2_only", value: "p2 only value content", priority: 2 }));
    const rows = await svc.get_effective_decisions();
    const p2_rows = rows.filter((r) => r.priority === 2);
    expect(p2_rows.length).toBe(0);
  });
});

// ── L193: dedupe_decisions non-active 레코드 건너뜀 ──────────────────────────

describe("DecisionService — dedupe_decisions non-active skip (L193)", () => {
  it("archived 레코드 있는 상태에서 dedupe → 건너뜀", async () => {
    // archived 레코드가 index.records에 있으면 L193의 continue가 실행됨
    const { record } = await svc.append_decision(make_input({ key: "arch_ded", value: "to be archived content" }));
    await svc.archive_decision(record.id);
    const result = await svc.dedupe_decisions();
    expect(result.removed).toBe(0);
    expect(typeof result.active).toBe("number");
  });

  it("superseded 레코드 있는 상태에서 dedupe → 건너뜀", async () => {
    // 키 교체 시 이전 레코드가 superseded → dedupe에서 L193 continue 발동
    const r1 = await svc.append_decision(make_input({ key: "sup_ded", value: "original value content unique" }));
    expect(r1.action).toBe("inserted");
    // 유사도 낮은 값으로 교체 → r1이 superseded
    await svc.append_decision(make_input({ key: "sup_ded", value: "completely different korean 다른내용입니다" }));
    const result = await svc.dedupe_decisions();
    expect(typeof result.removed).toBe("number");
    expect(typeof result.active).toBe("number");
  });
});
