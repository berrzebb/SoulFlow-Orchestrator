/**
 * PromiseService — append/archive/list/build_compact/dedupe 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromiseService } from "@src/decision/promise.service.js";

let tmp_dir: string;
let svc: PromiseService;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "promise-svc-"));
  svc = new PromiseService(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

describe("PromiseService — append_promise / list_promises", () => {
  it("새 약속 삽입 → inserted", async () => {
    const result = await svc.append_promise({ scope: "global", key: "no_debug_prints", value: "콘솔 디버그 출력 금지" });
    expect(result.action).toBe("inserted");
    expect(result.record.status).toBe("active");
  });

  it("동일 약속 재삽입 → deduped", async () => {
    await svc.append_promise({ scope: "global", key: "no_debug_prints", value: "콘솔 디버그 출력 금지" });
    const result = await svc.append_promise({ scope: "global", key: "no_debug_prints", value: "콘솔 디버그 출력 금지" });
    expect(result.action).toBe("deduped");
  });

  it("list_promises → 활성 약속 반환", async () => {
    await svc.append_promise({ scope: "global", key: "test_key", value: "test value" });
    const list = await svc.list_promises({ status: "active" });
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it("list_promises: 필터 없음 → 전체 반환", async () => {
    await svc.append_promise({ scope: "global", key: "key1", value: "value1" });
    const list = await svc.list_promises();
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("PromiseService — get_effective_promises", () => {
  it("약속 있음 → effective 목록 반환", async () => {
    await svc.append_promise({ scope: "global", key: "coding_rule", value: "항상 타입 안전 코드 작성", priority: 1 });
    const effective = await svc.get_effective_promises();
    expect(Array.isArray(effective)).toBe(true);
    expect(effective.length).toBeGreaterThan(0);
  });

  it("약속 없음 → 빈 배열", async () => {
    const effective = await svc.get_effective_promises();
    expect(effective).toEqual([]);
  });
});

describe("PromiseService — build_compact_injection", () => {
  it("약속 있음 → PROMISES_COMPACT 헤더 포함", async () => {
    await svc.append_promise({ scope: "global", key: "never_commit", value: "확인 전 커밋 금지", priority: 1 });
    const result = await svc.build_compact_injection();
    expect(result).toContain("PROMISES_COMPACT");
    expect(result).toContain("never_commit");
  });

  it("약속 없음 → 빈 문자열 반환", async () => {
    const result = await svc.build_compact_injection();
    expect(result).toBe("");
  });

  it("context 파라미터 → 필터된 결과", async () => {
    await svc.append_promise({ scope: "global", key: "rule1", value: "규칙1", priority: 1 });
    const result = await svc.build_compact_injection({ include_p2: false, p1_limit: 5 });
    expect(typeof result).toBe("string");
  });
});

describe("PromiseService — archive_promise", () => {
  it("존재하는 약속 아카이브 → true", async () => {
    const appended = await svc.append_promise({ scope: "global", key: "old_rule", value: "구식 규칙" });
    const archived = await svc.archive_promise(appended.record.id);
    expect(archived).toBe(true);
  });

  it("존재하지 않는 id → false", async () => {
    const archived = await svc.archive_promise("nonexistent-id");
    expect(archived).toBe(false);
  });
});

describe("PromiseService — dedupe_promises", () => {
  it("중복 없음 → removed=0", async () => {
    await svc.append_promise({ scope: "global", key: "unique1", value: "유일한 약속" });
    const result = await svc.dedupe_promises();
    expect(result.removed).toBe(0);
    expect(result.active).toBeGreaterThan(0);
  });

  it("약속 없음 → active=0", async () => {
    const result = await svc.dedupe_promises();
    expect(result.removed).toBe(0);
    expect(result.active).toBe(0);
  });
});

describe("PromiseService — promises_dir_override 생성자", () => {
  it("override 경로로 초기화 → 동작 정상", async () => {
    const custom_dir = join(tmp_dir, "custom-promises");
    const custom_svc = new PromiseService(tmp_dir, custom_dir);
    const result = await custom_svc.append_promise({ scope: "global", key: "custom_key", value: "커스텀 경로 약속" });
    expect(result.action).toBe("inserted");
  });
});
