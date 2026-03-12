/**
 * orchestration/prompts.ts + execution/helpers.ts 미커버 분기.
 * prompts.ts:
 *   L10: extract_persona_name 한국어 패턴
 *   L13: extract_persona_name 영문 패턴
 *   L77: build_bootstrap_overlay body
 *   L387: format_tool_label write_file
 *   L389: format_tool_label edit_file
 *   L395: format_tool_label web_fetch
 * helpers.ts:
 *   L78: resolve_reply_to 기타 provider
 *   L92: inbound_scope_id raw 없음
 *   L156: detect_hitl_type 빈 prompt
 */
import { describe, it, expect } from "vitest";
import {
  extract_persona_name,
  build_bootstrap_overlay,
  format_tool_label,
} from "@src/orchestration/prompts.js";
import {
  resolve_reply_to,
  inbound_scope_id,
  detect_hitl_type,
} from "@src/orchestration/execution/helpers.js";

// ══════════════════════════════════════════
// prompts.ts L10: extract_persona_name 한국어
// ══════════════════════════════════════════

describe("extract_persona_name — 한국어 패턴 (L10)", () => {
  it("이름: **Alice** → 'Alice' 반환", () => {
    expect(extract_persona_name("이름: **Alice**\n")).toBe("Alice");
  });

  it("이름: Bob (no stars) → 'Bob' 반환", () => {
    expect(extract_persona_name("이름: Bob\n설명: 어시스턴트")).toBe("Bob");
  });
});

// ══════════════════════════════════════════
// prompts.ts L13: extract_persona_name 영문
// ══════════════════════════════════════════

describe("extract_persona_name — 영문 패턴 (L13)", () => {
  it("name: Charlie → 'Charlie' 반환 (L13)", () => {
    // 한국어 패턴이 없고 영문만 있을 때
    expect(extract_persona_name("name: Charlie\nOther content")).toBe("Charlie");
  });

  it("Name: **Dana** → 'Dana' 반환 (L13)", () => {
    expect(extract_persona_name("Name: **Dana**\n")).toBe("Dana");
  });
});

// ══════════════════════════════════════════
// prompts.ts L77: build_bootstrap_overlay
// ══════════════════════════════════════════

describe("build_bootstrap_overlay (L77)", () => {
  it("persona_name + bootstrap_content → 오버레이 문자열 생성", () => {
    const result = build_bootstrap_overlay("TestBot", "## Setup\n초기 설정 내용");
    expect(result).toContain("Bootstrap Mode");
    expect(result).toContain("BOOTSTRAP.md");
  });

  it("persona_name='assistant' → (미설정) 표시", () => {
    const result = build_bootstrap_overlay("assistant", "content");
    expect(result).toContain("(미설정)");
  });
});

// ══════════════════════════════════════════
// prompts.ts L387/L389/L395: format_tool_label
// ══════════════════════════════════════════

describe("format_tool_label — write_file/edit_file/web_fetch (L387, L389, L395)", () => {
  it("write_file → file_path 포함 (L387)", () => {
    const r = format_tool_label("write_file", { file_path: "/tmp/out.txt" });
    expect(r).toContain("write_file");
    expect(r).toContain("/tmp/out.txt");
  });

  it("Write (alias) → file_path 포함 (L387)", () => {
    const r = format_tool_label("Write", { file_path: "src/main.ts" });
    expect(r).toContain("Write");
    expect(r).toContain("src/main.ts");
  });

  it("edit_file → file_path 포함 (L389)", () => {
    const r = format_tool_label("edit_file", { file_path: "README.md" });
    expect(r).toContain("README.md");
  });

  it("Edit (alias) → file_path 포함 (L389)", () => {
    const r = format_tool_label("Edit", { file_path: "config.json" });
    expect(r).toContain("config.json");
  });

  it("web_fetch → url 포함 (L395)", () => {
    const r = format_tool_label("web_fetch", { url: "https://example.com" });
    expect(r).toContain("https://example.com");
  });
});

// ══════════════════════════════════════════
// helpers.ts L78: resolve_reply_to 기타 provider
// ══════════════════════════════════════════

describe("resolve_reply_to — 기타 provider (L78)", () => {
  it("provider='discord' → meta.message_id 반환 (L78)", () => {
    const msg = { id: "msg1", metadata: { message_id: "discord-msg-123" } } as any;
    const result = resolve_reply_to("discord" as any, msg);
    expect(result).toBe("discord-msg-123");
  });

  it("provider='discord' + message.id → id 반환 (L78)", () => {
    const msg = { id: "msg-456", metadata: {} } as any;
    const result = resolve_reply_to("discord" as any, msg);
    expect(result).toBe("msg-456");
  });
});

// ══════════════════════════════════════════
// helpers.ts L92: inbound_scope_id raw 없음
// ══════════════════════════════════════════

describe("inbound_scope_id — raw 없음 (L92)", () => {
  it("message.id='' + metadata={} → 'msg-{timestamp}' (L92)", () => {
    const msg = { id: "", metadata: {} } as any;
    const result = inbound_scope_id(msg);
    expect(result).toMatch(/^msg-\d+$/);
  });
});

// ══════════════════════════════════════════
// helpers.ts L156: detect_hitl_type 빈 prompt
// ══════════════════════════════════════════

describe("detect_hitl_type — 빈 prompt (L156)", () => {
  it("빈 문자열 → 'question' 반환 (L156)", () => {
    expect(detect_hitl_type("")).toBe("question");
  });
});
