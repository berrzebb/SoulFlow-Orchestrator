import { describe, it, expect } from "vitest";
import { DataMaskTool } from "../../src/agent/tools/data-mask.js";

function make_tool() {
  return new DataMaskTool({ secret_vault: undefined as never });
}

describe("DataMaskTool", () => {
  describe("mask_email", () => {
    it("이메일 로컬 파트 마스킹", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mask_email", text: "contact john@example.com please" }));
      expect(r.masked).not.toContain("john@");
      expect(r.masked).toContain("@example.com");
      expect(r.count).toBe(1);
    });

    it("여러 이메일 모두 마스킹", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mask_email", text: "a@b.com and c@d.com" }));
      expect(r.count).toBe(2);
    });
  });

  describe("mask_phone", () => {
    it("전화번호 뒤 4자리만 노출", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mask_phone", text: "Call 010-1234-5678" }));
      expect(r.masked).toContain("5678");
      expect(r.count).toBe(1);
    });
  });

  describe("mask_card", () => {
    it("카드번호 뒤 4자리만 노출", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mask_card", text: "Card: 1234-5678-9012-3456" }));
      expect(r.masked).toContain("3456");
      expect(r.masked).not.toContain("1234-5678");
      expect(r.count).toBe(1);
    });
  });

  describe("mask_ip", () => {
    it("IP 중간 옥텟 마스킹", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mask_ip", text: "Server: 192.168.1.100" }));
      // 코드: parts[0] + ".***.***."+parts[3]
      expect(r.masked).toContain("192.***.***.100");
      expect(r.count).toBe(1);
    });
  });

  describe("detect_pii", () => {
    it("PII 탐지 — 이메일+전화", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "detect_pii", text: "Email: test@mail.com Phone: 010-1234-5678" }));
      expect(r.pii_detected).toBe(true);
      expect(r.total).toBeGreaterThanOrEqual(2);
      const types = r.findings.map((f: { type: string }) => f.type);
      expect(types).toContain("email");
      expect(types).toContain("phone");
    });

    it("PII 없음", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "detect_pii", text: "Hello world" }));
      expect(r.pii_detected).toBe(false);
      expect(r.total).toBe(0);
    });
  });

  describe("redact", () => {
    it("모든 PII를 [REDACTED]로 치환", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "redact", text: "Email: a@b.com IP: 10.0.0.1" }));
      expect(r.redacted).toContain("[REDACTED]");
      expect(r.redacted).not.toContain("a@b.com");
      expect(r.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("custom_mask", () => {
    it("커스텀 패턴 마스킹", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "custom_mask", text: "ID: ABC-123 and DEF-456", pattern: "[A-Z]{3}-\\d{3}", replacement: "[ID]" }));
      expect(r.masked).toBe("ID: [ID] and [ID]");
      expect(r.count).toBe(2);
    });

    it("패턴 없으면 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "custom_mask", text: "test" }));
      expect(r.error).toContain("pattern");
    });

    it("잘못된 정규식 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "custom_mask", text: "test", pattern: "[invalid" }));
      expect(r.error).toContain("invalid pattern");
    });
  });

  it("알 수 없는 액션 → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown" as never, text: "test" }));
    expect(r.error).toContain("unknown action");
  });
});
