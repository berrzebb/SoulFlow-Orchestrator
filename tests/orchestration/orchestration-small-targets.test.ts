/**
 * orchestration 소규모 미커버 분기 통합 테스트.
 * - completion-checker.ts L68: DYNAMIC_RULES questions>=5 break
 * - intent-patterns.ts L29: extract_file_extensions with actual matches
 * - confirmation-guard.ts L114: prune_expired expired entry
 * - confirmation-guard.ts L117: prune_expired skip_once.size>10
 * - skill-index.ts L178: close() 호출
 * - agent-hooks-builder.ts L67, L204-205: hook builder edge cases
 * - request-preflight.ts L157, L167-168, L251: preflight 분기
 * - prompts.ts uncovered
 */
import { describe, it, expect, vi } from "vitest";
import { generate_completion_checks } from "@src/orchestration/completion-checker.js";
import { extract_file_extensions, extract_intents } from "@src/orchestration/intent-patterns.js";
import { ConfirmationGuard } from "@src/orchestration/confirmation-guard.js";
import { SkillIndex } from "@src/orchestration/skill-index.js";

// ══════════════════════════════════════════
// completion-checker L68: questions>=5 → break
// ══════════════════════════════════════════

describe("completion-checker — DYNAMIC_RULES questions>=5 break (L68)", () => {
  it("1 skill-check + 4 dynamic rules 모두 매칭 → questions=5에서 break", () => {
    // 1개 스킬 체크 + has_role=true + 모든 DYNAMIC_RULES 툴 매칭 → 5번째에서 L68 break
    const skill_with_check = {
      name: "test-skill",
      checks: ["스킬 체크 완료했나요?"],
    } as any;

    const tools_used = [
      "write_file",      // DYNAMIC_RULES[0]
      "exec",            // DYNAMIC_RULES[1]
      "web_search",      // DYNAMIC_RULES[2]
      "oauth_fetch",     // DYNAMIC_RULES[3]
    ];

    const result = generate_completion_checks(tools_used, [skill_with_check], 0, true);
    // 스킬 체크(1) + 다이나믹(4) = 5개, L68에서 break 후 5개
    expect(result.questions.length).toBe(5);
    expect(result.has_checks).toBe(true);
  });

  it("has_role=true + questions가 이미 5개 → 동적 루프 진입 안 함", () => {
    const skills = Array.from({ length: 5 }, (_, i) => ({
      name: `skill-${i}`,
      checks: [`Check ${i}`],
    } as any));
    const result = generate_completion_checks([], skills, 0, true);
    expect(result.questions.length).toBe(5);
  });
});

// ══════════════════════════════════════════
// intent-patterns L29: extract_file_extensions with matches
// ══════════════════════════════════════════

describe("intent-patterns — extract_file_extensions with matches (L29)", () => {
  it("파일 확장자가 있는 텍스트 → Set + lowercase 처리 (L29)", () => {
    const result = extract_file_extensions("Please analyze data.CSV and report.TXT files");
    expect(result).toContain(".csv");
    expect(result).toContain(".txt");
    // 중복 제거 확인
    const result2 = extract_file_extensions("file.js and another.js");
    expect(result2.filter(e => e === ".js").length).toBe(1);
  });

  it("확장자 없는 텍스트 → 빈 배열 반환", () => {
    const result = extract_file_extensions("no extensions here");
    expect(result).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// confirmation-guard L114: prune_expired 만료 항목 제거
// ══════════════════════════════════════════

describe("ConfirmationGuard — prune_expired 만료 항목 (L114, L117)", () => {
  it("만료된 pending 항목 → prune_expired에서 삭제 (L114)", () => {
    const guard = new ConfirmationGuard({ enabled: true, ttl_ms: 1 }); // 1ms TTL
    guard.store("slack", "ch1", "do x", "summary", "once", []);
    // 잠시 후 만료
    const now = Date.now();
    // pending.created_at을 과거로 조작
    const key = "slack:ch1";
    const old_entry = { original_text: "do x", mode: "once", tool_categories: [], summary: "s", created_at: now - 10 };
    (guard as any).pending.set(key, old_entry);
    // get_status → prune_expired → L114: 만료 항목 삭제
    const status = guard.get_status();
    expect(status.pending_count).toBe(0); // 만료된 항목 제거됨
  });

  it("skip_once.size > 10 → clear (L117)", () => {
    const guard = new ConfirmationGuard({ enabled: true });
    // skip_once에 11개 이상 추가
    for (let i = 0; i < 11; i++) {
      (guard as any).skip_once.add(`key:${i}`);
    }
    expect((guard as any).skip_once.size).toBe(11);
    // get_status → prune_expired → L117: skip_once.clear()
    guard.get_status();
    expect((guard as any).skip_once.size).toBe(0);
  });
});

// ══════════════════════════════════════════
// skill-index L178: close() 호출
// ══════════════════════════════════════════

describe("SkillIndex — close() 호출 (L178)", () => {
  it("close() → DB 연결 정리 (L178)", () => {
    const idx = new SkillIndex();
    idx.build([]);
    // close 호출 → L178: try { this.db.close() } catch { noop }
    expect(() => idx.close()).not.toThrow();
  });

  it("close() 두 번 호출 → catch 분기 처리 (L178 catch)", () => {
    const idx = new SkillIndex();
    idx.close(); // 첫 번째 close
    // 두 번째 close → DB 이미 닫혀 있을 수 있음 → catch { noop }
    expect(() => idx.close()).not.toThrow();
  });
});
