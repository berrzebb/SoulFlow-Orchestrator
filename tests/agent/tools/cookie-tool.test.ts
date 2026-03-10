/**
 * CookieTool — HTTP Cookie 파싱/직렬화/검증/jar 관리 테스트.
 */
import { describe, it, expect } from "vitest";
import { CookieTool } from "../../../src/agent/tools/cookie.js";

const tool = new CookieTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("CookieTool — parse", () => {
  it("Cookie 헤더 파싱", async () => {
    const r = await exec({ action: "parse", cookie: "session=abc123; theme=dark; lang=ko" }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    const cookies = r.cookies as Record<string, string>;
    expect(cookies.session).toBe("abc123");
    expect(cookies.theme).toBe("dark");
    expect(cookies.lang).toBe("ko");
  });

  it("빈 Cookie → count 0", async () => {
    const r = await exec({ action: "parse", cookie: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("단일 Cookie 파싱", async () => {
    const r = await exec({ action: "parse", cookie: "token=xyz" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const cookies = r.cookies as Record<string, string>;
    expect(cookies.token).toBe("xyz");
  });
});

describe("CookieTool — serialize", () => {
  it("name=value 직렬화", async () => {
    const r = String(await exec({ action: "serialize", name: "session", value: "abc123" }));
    expect(r).toBe("session=abc123");
  });
});

describe("CookieTool — parse_set_cookie", () => {
  it("Set-Cookie 헤더 파싱 (기본 속성들)", async () => {
    const set_cookie = "session=abc123; Domain=example.com; Path=/; HttpOnly; Secure; SameSite=Strict";
    const r = await exec({ action: "parse_set_cookie", set_cookie }) as Record<string, unknown>;
    expect(r.name).toBe("session");
    expect(r.value).toBe("abc123");
    expect(r.domain).toBe("example.com");
    expect(r.path).toBe("/");
    expect(r.http_only).toBe(true);
    expect(r.secure).toBe(true);
    expect(r.same_site).toBe("Strict");
  });

  it("Max-Age 파싱", async () => {
    const r = await exec({ action: "parse_set_cookie", set_cookie: "token=val; Max-Age=3600" }) as Record<string, unknown>;
    expect(r.max_age).toBe(3600);
  });

  it("Expires 파싱", async () => {
    const r = await exec({ action: "parse_set_cookie", set_cookie: "token=val; Expires=Wed, 09 Jun 2021 10:18:14 GMT" }) as Record<string, unknown>;
    expect(String(r.expires)).toContain("2021");
  });
});

describe("CookieTool — build_set_cookie", () => {
  it("Set-Cookie 문자열 빌드", async () => {
    const r = String(await exec({
      action: "build_set_cookie",
      name: "session",
      value: "abc123",
      domain: "example.com",
      path: "/",
      secure: true,
      http_only: true,
      same_site: "Strict",
      max_age: 3600,
    }));
    expect(r).toContain("session=abc123");
    expect(r).toContain("Domain=example.com");
    expect(r).toContain("Path=/");
    expect(r).toContain("Secure");
    expect(r).toContain("HttpOnly");
    expect(r).toContain("SameSite=Strict");
    expect(r).toContain("Max-Age=3600");
  });

  it("최소 속성으로 빌드", async () => {
    const r = String(await exec({ action: "build_set_cookie", name: "x", value: "y" }));
    expect(r).toBe("x=y");
  });

  it("expires 포함 빌드 → L155 Expires 헤더", async () => {
    const r = String(await exec({ action: "build_set_cookie", name: "sess", value: "abc", expires: "Thu, 01 Jan 2099 00:00:00 GMT" }));
    expect(r).toContain("Expires=Thu, 01 Jan 2099 00:00:00 GMT");
  });
});

describe("CookieTool — validate", () => {
  it("이름에 특수문자 → L89 invalid characters error", async () => {
    // cookie name contains ";" → /[\s,;=]/.test(name) → L89 실행
    const r = await exec({ action: "validate", cookie: "bad;name=value" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e: unknown) => String(e).includes("invalid characters"))).toBe(true);
  });

  it("유효한 Cookie → valid: true", async () => {
    const r = await exec({ action: "validate", cookie: "session=abc123" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("빈 Cookie → valid: false", async () => {
    const r = await exec({ action: "validate", cookie: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("name=value 형식 없음 → valid: false", async () => {
    const r = await exec({ action: "validate", cookie: "justname" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("SameSite=None + Secure 없음 → 오류", async () => {
    const r = await exec({ action: "validate", cookie: "x=y", same_site: "None", secure: false }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("Secure"))).toBe(true);
  });

  it("유효하지 않은 SameSite → 오류", async () => {
    const r = await exec({ action: "validate", cookie: "x=y", same_site: "Invalid" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("CookieTool — jar_merge", () => {
  it("두 jar 병합 (이름 중복 → 덮어쓰기)", async () => {
    const jar = JSON.stringify([{ name: "a", value: "1", domain: "example.com", path: "/" }]);
    const jar2 = JSON.stringify([{ name: "a", value: "2", domain: "example.com", path: "/" }, { name: "b", value: "3" }]);
    const r = await exec({ action: "jar_merge", jar, jar2 }) as Record<string, unknown>;
    expect(r.count).toBe(2); // a와 b
    const cookies = r.cookies as Record<string, unknown>[];
    const a = cookies.find((c) => c.name === "a") as Record<string, unknown>;
    expect(a.value).toBe("2"); // 덮어쓰기
  });

  it("잘못된 jar JSON → error", async () => {
    const r = await exec({ action: "jar_merge", jar: "bad", jar2: "[]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("잘못된 jar2 JSON → L101 error", async () => {
    const r = await exec({ action: "jar_merge", jar: "[]", jar2: "{bad}" }) as Record<string, unknown>;
    expect(r.error).toContain("jar2");
  });
});

describe("CookieTool — is_expired", () => {
  it("과거 Expires → expired: true", async () => {
    const r = await exec({ action: "is_expired", set_cookie: "x=y; Expires=Thu, 01 Jan 2000 00:00:00 GMT" }) as Record<string, unknown>;
    expect(r.expired).toBe(true);
  });

  it("미래 Expires → expired: false", async () => {
    const r = await exec({ action: "is_expired", set_cookie: "x=y; Expires=Sun, 01 Jan 2099 00:00:00 GMT" }) as Record<string, unknown>;
    expect(r.expired).toBe(false);
  });

  it("Max-Age=0 → expired: true", async () => {
    const r = await exec({ action: "is_expired", set_cookie: "x=y; Max-Age=0" }) as Record<string, unknown>;
    expect(r.expired).toBe(true);
  });

  it("Max-Age=-1 → expired: true", async () => {
    const r = await exec({ action: "is_expired", set_cookie: "x=y; Max-Age=-1" }) as Record<string, unknown>;
    expect(r.expired).toBe(true);
  });

  it("Expires 없음 → expired: false", async () => {
    const r = await exec({ action: "is_expired", set_cookie: "x=y" }) as Record<string, unknown>;
    expect(r.expired).toBe(false);
  });
});
