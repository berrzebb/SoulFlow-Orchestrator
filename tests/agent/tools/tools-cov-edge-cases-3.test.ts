/**
 * 미커버 분기 보충 (edge-cases-3):
 *
 * - csp.ts L51:   parse action — if (!trimmed) continue (더블 세미콜론 → 빈 파트)
 * - csp.ts L65:   validate action — if (!trimmed) continue
 * - csp.ts L116:  parse_policy() — if (!trimmed) continue
 * - http-header.ts L63:  content_type — catch { extra = {}; } (잘못된 JSON params)
 * - http-header.ts L92:  cache_control — catch { directives = {}; } (잘못된 JSON)
 * - cron-shell.ts L101:  execute_job — if (!entry.enabled) return (disabled 진입)
 * - cron-shell.ts L122:  cron_to_interval_ms — if (parts.length < 5) return null
 */

import { describe, it, expect } from "vitest";
import { CspTool } from "@src/agent/tools/csp.js";
import { HttpHeaderTool } from "@src/agent/tools/http-header.js";
import { CronShellTool } from "@src/agent/tools/cron-shell.js";

// ── csp.ts L51: parse action — if (!trimmed) continue ────────────────────────

describe("CspTool — L51: parse 더블 세미콜론 → 빈 파트 continue", () => {
  const tool = new CspTool();

  it("더블 세미콜론 CSP → 빈 파트 무시하고 정상 파싱 (L51)", async () => {
    // "default-src 'self';;img-src *" → split(";") 결과에 "" 파트 포함 → L51 continue
    const r = JSON.parse(await tool.execute({
      action: "parse",
      policy: "default-src 'self';;img-src *",
    }));
    expect(r.directive_count).toBe(2);
    expect(r.directives["default-src"]).toContain("'self'");
    expect(r.directives["img-src"]).toContain("*");
  });

  it("앞뒤 세미콜론 → 앞뒤 빈 파트 무시 (L51)", async () => {
    const r = JSON.parse(await tool.execute({
      action: "parse",
      policy: ";default-src 'self';",
    }));
    expect(r.directive_count).toBe(1);
  });
});

// ── csp.ts L65: validate action — if (!trimmed) continue ─────────────────────

describe("CspTool — L65: validate 더블 세미콜론 → 빈 파트 continue", () => {
  const tool = new CspTool();

  it("더블 세미콜론 → L65 continue → directive_count 올바르게 계산 (L65)", async () => {
    const r = JSON.parse(await tool.execute({
      action: "validate",
      policy: "default-src 'self';;script-src 'nonce-abc'",
    }));
    // 빈 파트 무시 → 유효한 2개 directive만 파싱
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("세미콜론만으로 구성된 정책 → 빈 파트만 continue → 경고 발생 (L65)", async () => {
    const r = JSON.parse(await tool.execute({
      action: "validate",
      policy: ";;;",
    }));
    // 모든 파트가 빈 파트 → directive 없음 → missing default-src/script-src 경고
    expect(r.warnings).toContain("missing default-src or script-src");
  });
});

// ── csp.ts L116: parse_policy() — if (!trimmed) continue ─────────────────────

describe("CspTool — L116: parse_policy 더블 세미콜론 → 빈 파트 continue", () => {
  const tool = new CspTool();

  it("merge action에서 parse_policy 호출 → 더블 세미콜론 → L116 continue", async () => {
    // merge는 내부적으로 parse_policy를 사용
    const result = await tool.execute({
      action: "merge",
      policy: "default-src 'self';;font-src fonts.google.com",
      policy2: "img-src *",
    });
    // 결과에 default-src, font-src, img-src 모두 포함
    expect(result).toContain("default-src");
    expect(result).toContain("img-src");
  });

  it("check_source action에서 parse_policy → 더블 세미콜론 → L116 continue", async () => {
    const r = JSON.parse(await tool.execute({
      action: "check_source",
      policy: "script-src 'self';;default-src *",
      directive: "script-src",
      source: "'self'",
    }));
    expect(r.allowed).toBe(true);
  });
});

// ── http-header.ts L63: content_type — catch { extra = {}; } ─────────────────

describe("HttpHeaderTool — L63: content_type 잘못된 params JSON → catch", () => {
  const tool = new HttpHeaderTool();

  it("params='not-json' → JSON.parse 실패 → catch extra={} → L63", async () => {
    const r = JSON.parse(await tool.execute({
      action: "content_type",
      type: "application/json",
      params: "not-valid-json",
    }));
    // catch 실행: extra={} → params 없이 Content-Type 빌드
    expect(r.media_type).toBe("application/json");
    expect(r.value).toBe("application/json");
  });

  it("params='{malformed' → catch → header에 params 미포함 (L63)", async () => {
    const r = JSON.parse(await tool.execute({
      action: "content_type",
      type: "text/html",
      params: "{malformed",
    }));
    expect(r.header).toBe("Content-Type");
    expect(r.value).toBe("text/html");
  });
});

// ── http-header.ts L92: cache_control — catch { directives = {}; } ────────────

describe("HttpHeaderTool — L92: cache_control 잘못된 directives JSON → catch", () => {
  const tool = new HttpHeaderTool();

  it("directives='not-json' → JSON.parse 실패 → catch directives={} → L92", async () => {
    // params.header 없음 → directives 분기로 진입 → JSON.parse 실패 → catch
    const r = JSON.parse(await tool.execute({
      action: "cache_control",
      directives: "not-valid-json",
    }));
    // catch 실행: directives={} → 빈 parts 배열 → value=""
    expect(r.header).toBe("Cache-Control");
    expect(r.value).toBe("");
  });

  it("directives='{bad' → catch → 빈 Cache-Control 반환 (L92)", async () => {
    const r = JSON.parse(await tool.execute({
      action: "cache_control",
      directives: "{bad",
    }));
    expect(r.directives).toEqual({});
  });
});

// ── cron-shell.ts L122: cron_to_interval_ms — parts.length < 5 → null ────────

describe("CronShellTool — L122: 5개 미만 파트 → cron_to_interval_ms null → register 에러", () => {
  const tool = new CronShellTool({ workspace: process.cwd() });

  it("expression='* *' (2파트) → L122 return null → register 오류 반환", async () => {
    const result = await tool.execute({
      operation: "register",
      id: "short-expr-job",
      expression: "* *",
      command: "echo test",
    });
    expect(result).toContain("Error");
    expect(result).toContain("simple cron intervals");
  });

  it("expression='*/5 * *' (3파트) → L122 return null (L122)", async () => {
    const result = await tool.execute({
      operation: "register",
      id: "three-part-job",
      expression: "*/5 * *",
      command: "echo hi",
    });
    expect(result).toContain("Error");
  });
});

// ── cron-shell.ts L101: execute_job — if (!entry.enabled) return ──────────────

describe("CronShellTool — L101: disabled 엔트리 → execute_job early return", () => {
  it("entry.enabled=false → execute_job → L101 return (trigger 호출 시)", async () => {
    const tool = new CronShellTool({ workspace: process.cwd() });

    // 잡 등록
    await tool.execute({
      operation: "register",
      id: "disable-test",
      expression: "*/1 * * * *",
      command: "echo hello",
    });

    // private entries 직접 접근하여 enabled=false 설정 (L101 커버)
    const entries = (tool as any).entries as Map<string, { enabled: boolean; run_count: number }>;
    const entry = entries.get("disable-test")!;
    entry.enabled = false;

    // trigger 호출 → execute_job → L101: !entry.enabled → return (run_count 증가 안 함)
    await tool.execute({ operation: "trigger", id: "disable-test" });

    // disabled이므로 run_count가 0으로 유지
    expect(entry.run_count).toBe(0);

    // cleanup: 타이머 제거
    await tool.execute({ operation: "remove", id: "disable-test" });
  });
});
