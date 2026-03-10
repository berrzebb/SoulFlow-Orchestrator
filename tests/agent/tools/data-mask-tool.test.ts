/**
 * DataMaskTool — PII 마스킹 전 액션 커버리지.
 */
import { describe, it, expect } from "vitest";
import { DataMaskTool } from "@src/agent/tools/data-mask.js";

const tool = new DataMaskTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(r); } catch { return r; }
}

describe("DataMaskTool — 메타데이터", () => {
  it("name = data_mask", () => expect(tool.name).toBe("data_mask"));
  it("category = security", () => expect(tool.category).toBe("security"));
});

describe("DataMaskTool — mask_email", () => {
  it("이메일 마스킹", async () => {
    const r = await exec({ action: "mask_email", text: "Contact us at user@example.com" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(String(r.masked)).toContain("@example.com");
    expect(String(r.masked)).not.toContain("user@");
  });

  it("이메일 없음 → count=0", async () => {
    const r = await exec({ action: "mask_email", text: "no email here" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("DataMaskTool — mask_phone", () => {
  it("전화번호 마스킹", async () => {
    const r = await exec({ action: "mask_phone", text: "Call 555-123-4567" }) as Record<string, unknown>;
    expect(r.count).toBeGreaterThanOrEqual(1);
  });
});

describe("DataMaskTool — mask_card", () => {
  it("카드번호 마스킹 → 마지막 4자리만 표시", async () => {
    const r = await exec({ action: "mask_card", text: "Card: 4111 1111 1111 1111" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(String(r.masked)).toContain("1111");
  });
});

describe("DataMaskTool — mask_ip", () => {
  it("IP 주소 마스킹", async () => {
    const r = await exec({ action: "mask_ip", text: "Server at 192.168.1.100" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(String(r.masked)).toContain("192.***.***.");
  });
});

describe("DataMaskTool — detect_pii", () => {
  it("PII 탐지 → 이메일/카드 포함", async () => {
    const r = await exec({ action: "detect_pii", text: "Email: test@test.com, SSN: 123-45-6789" }) as Record<string, unknown>;
    expect(r.pii_detected).toBe(true);
    expect(typeof r.total).toBe("number");
  });

  it("PII 없음 → pii_detected=false", async () => {
    const r = await exec({ action: "detect_pii", text: "Hello world" }) as Record<string, unknown>;
    expect(r.pii_detected).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe("DataMaskTool — redact", () => {
  it("전체 PII [REDACTED] 치환", async () => {
    const r = await exec({ action: "redact", text: "Email: user@example.com IP: 10.0.0.1" }) as Record<string, unknown>;
    expect(String(r.redacted)).toContain("[REDACTED]");
    expect(r.count).toBeGreaterThan(0);
  });
});

describe("DataMaskTool — custom_mask", () => {
  it("커스텀 패턴 마스킹", async () => {
    const r = await exec({ action: "custom_mask", text: "SECRET-123 SECRET-456", pattern: "SECRET-\\d+", replacement: "[HIDDEN]" }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    expect(String(r.masked)).toContain("[HIDDEN]");
  });

  it("pattern 없음 → error", async () => {
    const r = await exec({ action: "custom_mask", text: "test" }) as Record<string, unknown>;
    expect(r.error).toContain("pattern");
  });

  it("잘못된 regex → error", async () => {
    const r = await exec({ action: "custom_mask", text: "test", pattern: "[invalid" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid pattern");
  });
});

describe("DataMaskTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_op" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });
});

describe("DataMaskTool — L15 mask_chars 짧은 문자열", () => {
  it("1글자 local part 이메일 → L15 char.repeat(s.length)", async () => {
    // local="a" → s.length(1) <= visible_start(1)+visible_end(0) → L15 실행
    const r = await exec({ action: "mask_email", text: "a@example.com" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    // local part "a" → mask_chars("a",1,0) → "a".length(1) <= 1 → "*"
    expect(String(r.masked)).toContain("*@example.com");
  });
});
