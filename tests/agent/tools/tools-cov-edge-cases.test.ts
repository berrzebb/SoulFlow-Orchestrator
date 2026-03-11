/**
 * 여러 도구의 미커버 분기 보충 (edge-cases):
 *
 * - crontab.ts L166: describe() min starts with "star-slash" - every N minutes
 * - vcard.ts L97:    parse_vcard() 콜론 없는 라인 continue
 * - duration.ts L81: parse_duration("") !input return null
 * - jsonl.ts L90:    default Error unsupported action
 * - jsonl.ts L104:   get_field() current=null return undefined
 * - robots-txt.ts L92: parse_robots() 콜론 없는 라인 continue
 * - openapi.ts L153: spec_to_markdown() operation.description 있음 push
 * - assert.ts L116:  validate_type() actual !== type return false
 */

import { describe, it, expect } from "vitest";

// ── imports ─────────────────────────────────────────────────────────────────
import { CrontabTool } from "@src/agent/tools/crontab.js";
import { VcardTool } from "@src/agent/tools/vcard.js";
import { DurationTool } from "@src/agent/tools/duration.js";
import { JsonlTool } from "@src/agent/tools/jsonl.js";
import { RobotsTxtTool } from "@src/agent/tools/robots-txt.js";
import { OpenApiTool } from "@src/agent/tools/openapi.js";
import { AssertTool } from "@src/agent/tools/assert.js";

// ── crontab.ts L166: describe() — min.startsWith("*/") ──────────────────────

describe("CrontabTool — L166: min.startsWith('*/') → every N minutes", () => {
  const tool = new CrontabTool();

  it("*/5 * * * * → 'every 5 minutes' (L166)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "*/5 * * * *" }));
    expect(r.human).toContain("every 5 minutes");
  });

  it("*/10 * * * * → 'every 10 minutes' (L166)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "*/10 * * * *" }));
    expect(r.human).toContain("every 10 minutes");
  });
});

// ── vcard.ts L97: parse_vcard() — 콜론 없는 라인 → continue ─────────────────

describe("VcardTool — L97: parse_vcard 콜론 없는 라인 → continue", () => {
  const tool = new VcardTool();

  it("콜론 없는 라인이 포함된 vcard → 파싱 계속 (L97)", async () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:John Doe",
      "INVALID_LINE_WITHOUT_COLON",  // ← L97 triggers here
      "EMAIL:john@example.com",
      "END:VCARD",
    ].join("\n");
    const r = JSON.parse(await tool.execute({ action: "parse", vcard }));
    // 콜론 없는 라인은 무시되고 나머지 필드는 파싱됨
    expect(r.name).toBe("John Doe");
    expect(r.email).toBe("john@example.com");
  });
});

// ── duration.ts L81: parse_duration("") → !input → return null ──────────────

describe("DurationTool — L81: parse_duration 빈 입력 → return null", () => {
  const tool = new DurationTool();

  it("duration='' → parse_duration('') → !input = true → L81 return null → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "parse", duration: "" }));
    expect(r.error).toContain("cannot parse duration");
  });

  it("duration 파라미터 미전달 → 동일한 empty path (L81)", async () => {
    const r = JSON.parse(await tool.execute({ action: "parse" }));
    expect(r.error).toContain("cannot parse duration");
  });
});

// ── jsonl.ts L90: default → Error: unsupported action ───────────────────────

describe("JsonlTool — L90: 알 수 없는 action → Error 반환", () => {
  const tool = new JsonlTool();

  it("action='nonexistent' → L90 default Error 반환", async () => {
    const r = await tool.execute({ action: "nonexistent" });
    expect(String(r)).toContain("unsupported action");
    expect(String(r)).toContain("nonexistent");
  });
});

// ── jsonl.ts L104: get_field() — current=null → return undefined ─────────────

describe("JsonlTool — L104: get_field() — null 통과 → return undefined", () => {
  const tool = new JsonlTool();

  it("중첩 경로 중 null 도달 → get_field L104 return undefined (filter 결과 빈 배열)", async () => {
    // input: {"a": null} — "a.b" 경로로 접근 시 current=null → L104 fires
    const input = JSON.stringify({ a: null });
    const r = JSON.parse(await tool.execute({
      action: "filter",
      input,
      field: "a.b",
      value: "anything",
    }));
    // a=null → get_field → L104 → undefined → String(undefined)="undefined" !== "anything" → filtered out
    expect(r.count).toBe(0);
  });

  it("중첩 경로 중 primitive → L104 fires (map 액션)", async () => {
    // input: {"a": 42} — "a.b" 경로 → current=42, typeof 42 !== "object" → L104 return undefined
    // JSON 직렬화 시 undefined → null로 변환
    const input = JSON.stringify({ a: 42 });
    const r = JSON.parse(await tool.execute({
      action: "map",
      input,
      expression: "a.b",
    }));
    // get_field returns undefined → JSON serialized as null
    expect(r.values).toContain(null);
    expect(r.count).toBe(1);
  });
});

// ── robots-txt.ts L92: 콜론 없는 라인 → continue ────────────────────────────

describe("RobotsTxtTool — L92: parse_robots 콜론 없는 라인 → continue", () => {
  const tool = new RobotsTxtTool();

  it("콜론 없는 라인이 포함된 robots.txt → 무시되고 정상 파싱 (L92)", async () => {
    const robots = [
      "User-agent: *",
      "Disallow: /private",
      "INVALID_LINE_NO_COLON",   // ← L92 triggers here
      "Allow: /public",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    const r = JSON.parse(await tool.execute({ action: "parse", robots }));
    // 콜론 없는 라인은 건너뜀 → 나머지 파싱 정상
    expect(r.rules).toHaveLength(1);
    expect(r.sitemaps).toHaveLength(1);
  });
});

// ── robots-txt.ts L80: default unknown action ────────────────────────────────

describe("RobotsTxtTool — L80: unknown action error", () => {
  const tool = new RobotsTxtTool();

  it("알 수 없는 action → L80 error JSON 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "nonexistent_action" }));
    expect(r.error).toContain("unknown action");
  });
});

// ── openapi.ts L153: operation.description 있음 → markdown push ─────────────

describe("OpenApiTool — L153: operation.description → markdown에 포함", () => {
  const tool = new OpenApiTool();

  it("operation에 description 있으면 L153 push 실행 → markdown에 포함됨", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            summary: "List items",
            description: "Returns all items in the collection.",  // ← L153 triggers
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const r = await tool.execute({ action: "to_markdown", spec });
    expect(r).toContain("Returns all items in the collection.");
  });
});

// ── assert.ts L116: validate_type() — actual !== type → return false ─────────

describe("AssertTool — L116: validate_type 타입 불일치 → return false", () => {
  const tool = new AssertTool();

  it("value='hello'(string), schema.type='number' → actual≠type → L116 false → pass=false", async () => {
    const r = JSON.parse(await tool.execute({
      action: "schema",
      value: '"hello"',          // parsed = "hello" (string)
      expected: '{"type":"number"}',  // expected type: number
    }));
    // validate_type: actual="string" !== type="number" → L116 return false
    expect(r.pass).toBe(false);
  });

  it("value=42(number), schema.type='string' → L116 false", async () => {
    const r = JSON.parse(await tool.execute({
      action: "schema",
      value: "42",
      expected: '{"type":"string"}',
    }));
    expect(r.pass).toBe(false);
  });

  it("value=[], schema.type='object' → actual='array'≠'object' → L116 false", async () => {
    const r = JSON.parse(await tool.execute({
      action: "schema",
      value: "[]",
      expected: '{"type":"object"}',
    }));
    expect(r.pass).toBe(false);
  });
});
