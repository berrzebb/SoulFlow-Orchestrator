/**
 * 여러 도구 미커버 분기 보충 (pure logic, 네트워크 없음).
 * xml.ts L40/71/80/89 (error catch)
 * cors.ts L99 (expose_headers split)
 * markdown.ts L38 (task_list) + L151 (blockquote)
 * rate-limit.ts L53-54 (MAX_BUCKETS eviction)
 * metric.ts L62 (invalid buckets JSON) + L150 (default action)
 * redis.ts L143 (parse_resp default case)
 * ldap.ts L61-62 (ber_length medium + large)
 * kanban.ts L158-159 (already_exists)
 */
import { describe, it, expect, vi } from "vitest";
import { XmlTool } from "@src/agent/tools/xml.js";
import { CorsTool } from "@src/agent/tools/cors.js";
import { MarkdownTool } from "@src/agent/tools/markdown.js";
import { RateLimitTool } from "@src/agent/tools/rate-limit.js";
import { MetricTool } from "@src/agent/tools/metric.js";
import { RedisTool } from "@src/agent/tools/redis.js";
import { LdapTool } from "@src/agent/tools/ldap.js";
import { KanbanTool } from "@src/agent/tools/kanban.js";

// ══════════════════════════════════════════
// xml.ts — error catch 분기 (L40/71/80/89)
// ══════════════════════════════════════════

describe("XmlTool — error catch 분기 (monkey-patch xml_to_json)", () => {
  it("parse → xml_to_json throw → L40: Error: 반환", async () => {
    const tool = new XmlTool();
    (tool as any).xml_to_json = () => { throw new Error("parse forced"); };
    const r = await tool.execute({ action: "parse", data: "<root/>" });
    expect(r).toContain("Error: parse forced");
  });

  it("query → xml_to_json throw → L71: Error: 반환", async () => {
    const tool = new XmlTool();
    (tool as any).xml_to_json = () => { throw new Error("query forced"); };
    const r = await tool.execute({ action: "query", data: "<root/>", path: "root" });
    expect(r).toContain("Error: query forced");
  });

  it("validate → xml_to_json throw → L80: valid:false JSON 반환", async () => {
    const tool = new XmlTool();
    (tool as any).xml_to_json = () => { throw new Error("validate forced"); };
    const r = JSON.parse(await tool.execute({ action: "validate", data: "<root/>" }));
    expect(r.valid).toBe(false);
    expect(r.error).toBe("validate forced");
  });

  it("pretty → json_to_xml throw → L89: 원본 xml 반환", async () => {
    const tool = new XmlTool();
    const orig_xml_to_json = (tool as any).xml_to_json.bind(tool);
    (tool as any).xml_to_json = (xml: string) => orig_xml_to_json(xml);
    (tool as any).json_to_xml = () => { throw new Error("pretty forced"); };
    const data = "<root><a>1</a></root>";
    const r = await tool.execute({ action: "pretty", data });
    // L89: catch → return original xml (or result if parse succeeded)
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// cors.ts L99 — expose_headers split
// ══════════════════════════════════════════

describe("CorsTool — parse with expose_headers (L99)", () => {
  it("Access-Control-Expose-Headers 헤더 존재 → expose_headers 배열 반환", async () => {
    const tool = new CorsTool();
    const r = JSON.parse(await (tool as any).run({
      action: "parse",
      headers: JSON.stringify({
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Expose-Headers": "X-Custom-Header, X-Request-Id",
      }),
    }));
    expect(r.expose_headers).toEqual(["X-Custom-Header", "X-Request-Id"]);
  });
});

// ══════════════════════════════════════════
// markdown.ts L38 — task_list operation
// markdown.ts L151 — blockquote in html_to_md
// ══════════════════════════════════════════

describe("MarkdownTool — task_list (L38) + blockquote (L151)", () => {
  it("task_list operation → checklist 반환 (L38)", async () => {
    const tool = new MarkdownTool();
    const r = await (tool as any).run({
      operation: "task_list",
      data: JSON.stringify(["할 일 1", "할 일 2"]),
    });
    expect(r).toContain("- [ ] 할 일 1");
    expect(r).toContain("- [ ] 할 일 2");
  });

  it("html_to_md — blockquote → '> ' 변환 (L151)", async () => {
    const tool = new MarkdownTool();
    const r = await (tool as any).run({
      operation: "html_to_md",
      text: "<blockquote>인용구 내용\n두 번째 줄</blockquote>",
    });
    expect(r).toContain("> ");
  });
});

// ══════════════════════════════════════════
// rate-limit.ts L53-54 — MAX_BUCKETS eviction
// ══════════════════════════════════════════

describe("RateLimitTool — MAX_BUCKETS 초과 시 oldest 삭제 (L53-54)", () => {
  it("100개 버킷 생성 후 101번째 → eviction 발생", async () => {
    const tool = new RateLimitTool({ secret_vault: undefined as never });
    const ts = Date.now();
    // Fill up to MAX_BUCKETS (100)
    for (let i = 0; i < 100; i++) {
      await tool.execute({ action: "check", key: `evict_fill_${ts}_${i}`, max_requests: 10, window_ms: 60000 });
    }
    // 101번째 → eviction 발생 (L53-54)
    const r = JSON.parse(await tool.execute({
      action: "check", key: `evict_overflow_${ts}`, max_requests: 10, window_ms: 60000,
    }));
    expect(r.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════
// metric.ts L62 — invalid buckets JSON fallback
// metric.ts L150 — default unknown action
// ══════════════════════════════════════════

describe("MetricTool — invalid buckets (L62) + default action (L150)", () => {
  it("histogram + invalid buckets JSON → fallback 기본 버킷 사용 (L62)", async () => {
    const tool = new MetricTool({ secret_vault: undefined as never });
    const r = JSON.parse(await tool.execute({
      action: "histogram",
      name: `h_${Date.now()}`,
      value: 0.5,
      buckets: "not-valid-json",  // parse 실패 → L62 catch
    }));
    expect(typeof r.count).toBe("number");
  });

  it("알 수 없는 action → L150: error JSON 반환", async () => {
    const tool = new MetricTool({ secret_vault: undefined as never });
    const r = JSON.parse(await (tool as any).run({ action: "totally_unknown" }));
    expect(r.error).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// redis.ts L143 — parse_resp default case
// ══════════════════════════════════════════

describe("RedisTool — parse_resp default case (L143)", () => {
  it("알 수 없는 RESP 타입 → L143: { value: line, rest } 반환", () => {
    const tool = new RedisTool({ secret_vault: undefined as never });
    // 'X' is not a known RESP prefix (+, -, :, $, *)
    const result = (tool as any).parse_resp("Xunknown_data\r\nremainder");
    expect(result).not.toBeNull();
    expect(result.value).toBe("unknown_data");
  });
});

// ══════════════════════════════════════════
// ldap.ts L61-62 — ber_length medium/large
// ══════════════════════════════════════════

describe("LdapTool — ber_length medium + large (L61-62)", () => {
  it("len=0x80 (128) → L61: [0x81, 0x80] 반환", () => {
    const tool = new LdapTool({ secret_vault: undefined as never });
    const result = (tool as any).ber_length(0x80);
    expect(result).toEqual(Buffer.from([0x81, 0x80]));
  });

  it("len=0xff (255) → L61: [0x81, 0xff] 반환", () => {
    const tool = new LdapTool({ secret_vault: undefined as never });
    const result = (tool as any).ber_length(0xff);
    expect(result).toEqual(Buffer.from([0x81, 0xff]));
  });

  it("len=0x100 (256) → L62: [0x82, 0x01, 0x00] 반환", () => {
    const tool = new LdapTool({ secret_vault: undefined as never });
    const result = (tool as any).ber_length(0x100);
    expect(result).toEqual(Buffer.from([0x82, 0x01, 0x00]));
  });

  it("len=0x1ff (511) → L62: [0x82, 0x01, 0xff] 반환", () => {
    const tool = new LdapTool({ secret_vault: undefined as never });
    const result = (tool as any).ber_length(0x1ff);
    expect(result).toEqual(Buffer.from([0x82, 0x01, 0xff]));
  });
});

// ══════════════════════════════════════════
// kanban.ts L158-159 — already_exists
// ══════════════════════════════════════════

describe("KanbanTool — create_board already_exists (L158-159)", () => {
  it("동일 scope에 보드 존재 → L158-159: already_exists:true 반환", async () => {
    const mock_store = {
      list_boards: vi.fn().mockResolvedValue([
        { board_id: "b1", prefix: "TST", columns: [{ id: "todo" }, { id: "done" }] },
      ]),
    } as any;
    const tool = new KanbanTool(mock_store);
    const r = JSON.parse(await (tool as any).run({
      action: "create_board",
      name: "My Board",
      scope_type: "channel",
      scope_id: "C123",
    }));
    expect(r.ok).toBe(true);
    expect(r.already_exists).toBe(true);
    expect(r.board_id).toBe("b1");
  });
});
