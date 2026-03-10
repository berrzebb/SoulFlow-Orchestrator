/**
 * CryptoTool / TimezoneTool / LicenseTool / WhoisTool 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { CryptoTool } from "@src/agent/tools/crypto.js";
import { TimezoneTool } from "@src/agent/tools/timezone.js";
import { LicenseTool } from "@src/agent/tools/license.js";
import { WhoisTool } from "@src/agent/tools/whois.js";

// ══════════════════════════════════════════
// CryptoTool
// ══════════════════════════════════════════

describe("CryptoTool — 메타데이터", () => {
  const tool = new CryptoTool();
  it("name = crypto", () => expect(tool.name).toBe("crypto"));
  it("category = security", () => expect(tool.category).toBe("security"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});

describe("CryptoTool — generate_key", () => {
  const tool = new CryptoTool();

  it("AES 키 생성 (기본값)", async () => {
    const r = JSON.parse(await tool.execute({ action: "generate_key", key_type: "aes" }));
    expect(r.key_type).toBe("aes-256");
    expect(r.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("RSA 키 생성", async () => {
    const r = JSON.parse(await tool.execute({ action: "generate_key", key_type: "rsa", key_size: 2048 }));
    expect(r.key_type).toBe("rsa-2048");
    expect(r.public_key).toContain("BEGIN PUBLIC KEY");
    expect(r.private_key).toContain("BEGIN PRIVATE KEY");
  });

  it("지원하지 않는 key_type → Error", async () => {
    const r = await tool.execute({ action: "generate_key", key_type: "unknown" });
    expect(String(r)).toContain("Error");
  });
});

describe("CryptoTool — encrypt/decrypt", () => {
  const tool = new CryptoTool();

  it("encrypt → decrypt 왕복 검증", async () => {
    const key_r = JSON.parse(await tool.execute({ action: "generate_key", key_type: "aes" }));
    const key = key_r.key as string;

    const enc = JSON.parse(await tool.execute({ action: "encrypt", input: "hello world", key }));
    expect(enc.algorithm).toBe("aes-256-gcm");

    const dec = JSON.parse(await tool.execute({ action: "decrypt", input: enc.ciphertext, key, iv: enc.iv, auth_tag: enc.auth_tag }));
    expect(dec.plaintext).toBe("hello world");
  });

  it("encrypt: 키 길이 오류 → Error", async () => {
    const r = await tool.execute({ action: "encrypt", input: "test", key: "short" });
    expect(String(r)).toContain("Error");
  });

  it("decrypt: 키 길이 오류 → Error", async () => {
    const r = await tool.execute({ action: "decrypt", input: "aabb", key: "short", iv: "00", auth_tag: "00" });
    expect(String(r)).toContain("Error");
  });

  it("decrypt: iv/auth_tag 없음 → Error", async () => {
    const key = "a".repeat(64);
    const r = await tool.execute({ action: "decrypt", input: "aabb", key });
    expect(String(r)).toContain("Error");
  });

  it("decrypt: 잘못된 auth_tag → Error", async () => {
    const key_r = JSON.parse(await tool.execute({ action: "generate_key", key_type: "aes" }));
    const key = key_r.key as string;
    const enc = JSON.parse(await tool.execute({ action: "encrypt", input: "hi", key }));
    const r = await tool.execute({ action: "decrypt", input: enc.ciphertext, key, iv: enc.iv, auth_tag: "deadbeef" + "00".repeat(12) });
    expect(String(r)).toContain("Error");
  });
});

describe("CryptoTool — sign/verify", () => {
  const tool = new CryptoTool();

  it("RSA 서명 → 검증 성공", async () => {
    const keys = JSON.parse(await tool.execute({ action: "generate_key", key_type: "rsa", key_size: 2048 }));
    const sig_r = JSON.parse(await tool.execute({ action: "sign", input: "message to sign", key: keys.private_key }));
    expect(sig_r.algorithm).toBe("RSA-SHA256");

    const ver_r = JSON.parse(await tool.execute({ action: "verify", input: "message to sign", key: keys.public_key, signature: sig_r.signature }));
    expect(ver_r.valid).toBe(true);
  });

  it("sign: private key 없음 → Error", async () => {
    const r = await tool.execute({ action: "sign", input: "msg", key: "not-a-pem" });
    expect(String(r)).toContain("Error");
  });

  it("verify: public key 없음 → Error", async () => {
    const r = await tool.execute({ action: "verify", input: "msg", key: "not-a-pem", signature: "aabbcc" });
    expect(String(r)).toContain("Error");
  });

  it("verify: signature 없음 → Error", async () => {
    const r = await tool.execute({ action: "verify", input: "msg", key: "-----BEGIN PUBLIC KEY-----" });
    expect(String(r)).toContain("Error");
  });
});

describe("CryptoTool — unknown action", () => {
  it("지원하지 않는 action → Error", async () => {
    const tool = new CryptoTool();
    const r = await tool.execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// TimezoneTool
// ══════════════════════════════════════════

describe("TimezoneTool — 메타데이터", () => {
  const tool = new TimezoneTool();
  it("name = timezone", () => expect(tool.name).toBe("timezone"));
  it("category = data", () => expect(tool.category).toBe("data"));
});

describe("TimezoneTool — now", () => {
  const tool = new TimezoneTool();

  it("UTC now → datetime 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "now", timezone: "UTC" }));
    expect(r.timezone).toBe("UTC");
    expect(r.abbr).toBe("UTC");
    expect(r.datetime).toBeTruthy();
  });

  it("KST now → Korea Standard Time", async () => {
    const r = JSON.parse(await tool.execute({ action: "now", timezone: "Asia/Seoul" }));
    expect(r.timezone).toBe("Asia/Seoul");
  });

  it("약어로 조회 (EST)", async () => {
    const r = JSON.parse(await tool.execute({ action: "now", timezone: "EST" }));
    expect(r.abbr).toBe("EST");
  });

  it("알 수 없는 타임존 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "now", timezone: "Unknown/Zone" }));
    expect(r.error).toBeTruthy();
  });
});

describe("TimezoneTool — convert", () => {
  const tool = new TimezoneTool();

  it("UTC → Tokyo 변환", async () => {
    const r = JSON.parse(await tool.execute({
      action: "convert",
      datetime: "2024-01-01T00:00:00Z",
      from: "UTC",
      to: "Asia/Tokyo",
    }));
    expect(r.offset_diff).toBe(9);
  });

  it("알 수 없는 from 타임존 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", datetime: "2024-01-01T00:00:00Z", from: "Nowhere", to: "UTC" }));
    expect(r.error).toContain("unknown timezone");
  });

  it("알 수 없는 to 타임존 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", datetime: "2024-01-01T00:00:00Z", from: "UTC", to: "Nowhere" }));
    expect(r.error).toContain("unknown timezone");
  });

  it("잘못된 datetime → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", datetime: "not-a-date", from: "UTC", to: "UTC" }));
    expect(r.error).toContain("invalid");
  });
});

describe("TimezoneTool — list/info/offset/search", () => {
  const tool = new TimezoneTool();

  it("list → 전체 타임존 목록", async () => {
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r.count).toBeGreaterThan(0);
    expect(Array.isArray(r.timezones)).toBe(true);
  });

  it("info: UTC → 상세 정보", async () => {
    const r = JSON.parse(await tool.execute({ action: "info", timezone: "UTC" }));
    expect(r.id).toBe("UTC");
    expect(r.offset).toBe(0);
    expect(r.offset_string).toContain("UTC");
  });

  it("info: 알 수 없는 타임존 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "info", timezone: "Unknown" }));
    expect(r.error).toBeTruthy();
  });

  it("offset: IST 인도 → 5.5시간", async () => {
    const r = JSON.parse(await tool.execute({ action: "offset", timezone: "Asia/Kolkata" }));
    expect(r.offset_hours).toBe(5.5);
    expect(r.offset_string).toContain("+");
  });

  it("offset: PST → 음수 오프셋", async () => {
    const r = JSON.parse(await tool.execute({ action: "offset", timezone: "America/Los_Angeles" }));
    expect(r.offset_hours).toBeLessThan(0);
  });

  it("offset: 알 수 없는 타임존 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "offset", timezone: "Nowhere" }));
    expect(r.error).toBeTruthy();
  });

  it("search: 'tokyo' → 결과 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "search", query: "tokyo" }));
    expect(r.count).toBeGreaterThan(0);
    expect(r.results[0].id).toContain("Tokyo");
  });

  it("search: 존재하지 않는 쿼리 → count=0", async () => {
    const r = JSON.parse(await tool.execute({ action: "search", query: "zzznomatch" }));
    expect(r.count).toBe(0);
  });
});

describe("TimezoneTool — unknown action", () => {
  it("지원하지 않는 action → error", async () => {
    const tool = new TimezoneTool();
    const r = JSON.parse(await tool.execute({ action: "bogus" }));
    expect(r.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// LicenseTool
// ══════════════════════════════════════════

describe("LicenseTool — 메타데이터", () => {
  const tool = new LicenseTool();
  it("name = license", () => expect(tool.name).toBe("license"));
  it("category = data", () => expect(tool.category).toBe("data"));
});

describe("LicenseTool — generate", () => {
  const tool = new LicenseTool();

  it("MIT 라이선스 생성 → 연도/저작자 치환", async () => {
    const r = await tool.execute({ action: "generate", id: "MIT", year: "2024", author: "Alice" });
    expect(r).toContain("MIT License");
    expect(r).toContain("2024");
    expect(r).toContain("Alice");
    expect(r).not.toContain("{{year}}");
    expect(r).not.toContain("{{author}}");
  });

  it("Apache-2.0 라이선스 생성", async () => {
    const r = await tool.execute({ action: "generate", id: "Apache-2.0" });
    expect(r).toContain("Apache License");
  });

  it("ISC 라이선스 생성", async () => {
    const r = await tool.execute({ action: "generate", id: "ISC" });
    expect(r).toContain("ISC License");
  });

  it("BSD-2-Clause 라이선스 생성", async () => {
    const r = await tool.execute({ action: "generate", id: "BSD-2-Clause" });
    expect(r).toContain("BSD 2-Clause");
  });

  it("템플릿 없는 라이선스 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "generate", id: "GPL-3.0" }));
    expect(r.error).toBeTruthy();
    expect(Array.isArray(r.available)).toBe(true);
  });
});

describe("LicenseTool — detect", () => {
  const tool = new LicenseTool();

  it("MIT 텍스트 → MIT 감지", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "Permission is hereby granted MIT License" }));
    expect(r.detected).toBe("MIT");
  });

  it("Apache 텍스트 → Apache-2.0 감지", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "Apache License 2.0 Apache-2.0" }));
    expect(r.detected).toBe("Apache-2.0");
  });

  it("인식 불가 텍스트 → null", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "random unrelated text" }));
    expect(r.detected).toBeNull();
  });
});

describe("LicenseTool — info/compare/list/compatible", () => {
  const tool = new LicenseTool();

  it("info: MIT → 상세 정보", async () => {
    const r = JSON.parse(await tool.execute({ action: "info", id: "MIT" }));
    expect(r.id).toBe("MIT");
    expect(r.osi).toBe(true);
    expect(r.copyleft).toBe(false);
    expect(Array.isArray(r.permissions)).toBe(true);
  });

  it("info: 알 수 없는 라이선스 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "info", id: "UNKNOWN" }));
    expect(r.error).toBeTruthy();
  });

  it("compare: MIT vs Apache-2.0", async () => {
    const r = JSON.parse(await tool.execute({ action: "compare", id: "MIT", id2: "Apache-2.0" }));
    expect(r.license1).toBe("MIT");
    expect(r.license2).toBe("Apache-2.0");
    expect(r.both_osi).toBe(true);
    expect(Array.isArray(r.shared_permissions)).toBe(true);
  });

  it("compare: 알 수 없는 라이선스 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "compare", id: "MIT", id2: "UNKNOWN" }));
    expect(r.error).toBeTruthy();
  });

  it("list → 전체 라이선스 목록", async () => {
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r.count).toBeGreaterThan(0);
    expect(r.licenses.some((l: { id: string }) => l.id === "MIT")).toBe(true);
  });

  it("compatible: MIT → 비카피레프트 라이선스들과 호환", async () => {
    const r = JSON.parse(await tool.execute({ action: "compatible", id: "MIT" }));
    expect(r.license).toBe("MIT");
    expect(Array.isArray(r.compatible)).toBe(true);
    expect(r.compatible).toContain("Apache-2.0");
  });

  it("compatible: GPL-3.0 → copyleft 라이선스", async () => {
    const r = JSON.parse(await tool.execute({ action: "compatible", id: "GPL-3.0" }));
    expect(r.license).toBe("GPL-3.0");
    expect(Array.isArray(r.compatible)).toBe(true);
  });

  it("compatible: 알 수 없는 라이선스 → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "compatible", id: "UNKNOWN" }));
    expect(r.error).toBeTruthy();
  });
});

describe("LicenseTool — unknown action", () => {
  it("지원하지 않는 action → error", async () => {
    const tool = new LicenseTool();
    const r = JSON.parse(await tool.execute({ action: "bogus" }));
    expect(r.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// WhoisTool — network mock
// ══════════════════════════════════════════

describe("WhoisTool — 메타데이터", () => {
  const tool = new WhoisTool();
  it("name = whois", () => expect(tool.name).toBe("whois"));
  it("category = external", () => expect(tool.category).toBe("external"));
});

describe("WhoisTool — server action (네트워크 없음)", () => {
  const tool = new WhoisTool();

  it(".com → whois.verisign-grs.com", async () => {
    const r = JSON.parse(await tool.execute({ action: "server", domain: "example.com" }));
    expect(r.server).toBe("whois.verisign-grs.com");
  });

  it(".io → whois.nic.io", async () => {
    const r = JSON.parse(await tool.execute({ action: "server", domain: "example.io" }));
    expect(r.server).toBe("whois.nic.io");
  });

  it(".kr → whois.kr", async () => {
    const r = JSON.parse(await tool.execute({ action: "server", domain: "example.kr" }));
    expect(r.server).toBe("whois.kr");
  });

  it("알 수 없는 TLD → whois.iana.org 폴백", async () => {
    const r = JSON.parse(await tool.execute({ action: "server", domain: "example.zzzunknown" }));
    expect(r.server).toBe("whois.iana.org");
  });

  it("known_servers 포함", async () => {
    const r = JSON.parse(await tool.execute({ action: "server", domain: "example.net" }));
    expect(typeof r.known_servers).toBe("object");
  });
});

describe("WhoisTool — unknown action", () => {
  it("unknown action → error", async () => {
    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "unknown" }));
    expect(r.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// LicenseTool — 미커버 detect 분기
// ══════════════════════════════════════════

describe("LicenseTool — detect 미커버 분기", () => {
  const tool = new LicenseTool();

  it("GPL 텍스트 → GPL 감지 (L164 gnu general public)", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "GNU General Public License GPL-3.0" }));
    expect(r.detected).toContain("GPL");
  });

  it("ISC 텍스트 → ISC 감지 (L165 isc license)", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "ISC License ISC" }));
    expect(r.detected).toBe("ISC");
  });

  it("BSD-2-Clause 텍스트 → BSD-2-Clause 감지 (L166)", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "BSD 2-Clause BSD-2-Clause" }));
    expect(r.detected).toBe("BSD-2-Clause");
  });

  it("BSD-3-Clause 텍스트 → BSD-3-Clause 감지 (L167)", async () => {
    const r = JSON.parse(await tool.execute({ action: "detect", text: "BSD 3-Clause BSD-3-Clause" }));
    expect(r.detected).toBe("BSD-3-Clause");
  });
});
