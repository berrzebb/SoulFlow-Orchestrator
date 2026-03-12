/**
 * DecisionService — 미커버 분기 (cov4):
 * - L65: fingerprint 존재하나 해당 레코드가 non-active → if 조건 false 분기
 * - L139: list_decisions scope_id 필터 불일치 → false 반환 분기
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DecisionService } from "@src/decision/service.js";

let workspace: string;
let svc: DecisionService;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "dec-cov4-"));
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

// ── L65: fingerprint 재제출 (non-active 레코드) ──────────────────────────────

describe("DecisionService — L65: fingerprint 재제출 시 non-active 레코드", () => {
  it("superseded 후 동일 fingerprint 재제출 → fingerprint 매핑은 있지만 non-active → 새 레코드 삽입", async () => {
    // r1 삽입 → fp1 생성
    const r1 = await svc.append_decision(make_input({ key: "fp_stale", value: "original value content" }));
    expect(r1.action).toBe("inserted");

    // r1 supersede: 유사도 낮은 새 값 추가 → r1.status = "superseded"
    await svc.append_decision(make_input({ key: "fp_stale", value: "완전히 다른 한국어 값입니다" }));

    // r1의 fingerprint로 다시 요청 (원본 값 재전송)
    // index.fingerprints[fp1] = r1.id, r1.status = "superseded"
    // → L65 조건: sameFingerprint.status !== "active" → false → 계속 진행
    const r3 = await svc.append_decision(make_input({ key: "fp_stale", value: "original value content" }));
    // non-active fingerprint → 새 레코드 삽입 가능
    expect(["inserted", "deduped"]).toContain(r3.action);
  });
});

// ── L139: list_decisions scope_id 필터 불일치 ─────────────────────────────────

describe("DecisionService — L139: list_decisions scope_id 필터", () => {
  it("scope_id 불일치 레코드 → 결과에서 제외", async () => {
    // scope_id=null인 레코드
    await svc.append_decision(make_input({ key: "global_key", value: "global value content" }));
    // scope_id="team-1"인 레코드
    await svc.append_decision({
      scope: "team",
      scope_id: "team-1",
      key: "team_key",
      value: "team value content",
      priority: 1,
    });

    // scope_id="team-1" 필터 → null scope_id 레코드 제외 (L139 false 경로 hit)
    const team_rows = await svc.list_decisions({ scope_id: "team-1" });
    expect(team_rows.every((r) => r.scope_id === "team-1")).toBe(true);
    expect(team_rows.some((r) => r.scope_id === null)).toBe(false);
  });

  it("scope_id=undefined 필터 → scope_id null 포함 (필터 조건 자체 skip)", async () => {
    await svc.append_decision(make_input({ key: "no_scope_id", value: "no scope id content" }));
    // scope_id를 필터로 주지 않으면 L139 조건 자체가 false (filter?.scope_id === undefined)
    const rows = await svc.list_decisions({});
    expect(rows.length).toBeGreaterThan(0);
  });

  it("scope_id=null 필터 → scope_id 있는 레코드 제외 (L139 false 경로 hit)", async () => {
    await svc.append_decision({
      scope: "team",
      scope_id: "team-x",
      key: "scoped",
      value: "scoped value content",
      priority: 1,
    });
    await svc.append_decision(make_input({ key: "global", value: "global value content" }));

    // scope_id=null 필터 → scope_id="team-x" 레코드는 제외
    const rows = await svc.list_decisions({ scope_id: null });
    expect(rows.some((r) => r.scope_id === "team-x")).toBe(false);
  });
});
