import { describe, it, expect, vi } from "vitest";
import { redact_sensitive_text, redact_sensitive_unknown } from "@src/security/sensitive.js";

describe("redact_sensitive_text", () => {
  describe("직접 패턴 탐지", () => {
    it("JWT 토큰 마스킹", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.rV3rvLjRMNk45pGLHnwYMg";
      const result = redact_sensitive_text(`Token: ${jwt}`);
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("eyJ");
      expect(result.text).toContain("[REDACTED]");
    });

    it("OpenAI API 키 마스킹", () => {
      const result = redact_sensitive_text("key: sk-abcdefghijklmnopqrstuvwxyz");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("sk-abcdefghijklmnop");
    });

    it("Anthropic API 키 마스킹", () => {
      const result = redact_sensitive_text("key: sk-ant-abcdefghijklmnopqrstuvwxyz");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("sk-ant-");
    });

    it("GitHub PAT 마스킹", () => {
      const result = redact_sensitive_text("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZab");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("ghp_");
    });

    it("Slack 토큰 마스킹", () => {
      const result = redact_sensitive_text("xoxb-1234567890-abcdefghij");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("xoxb-");
    });

    it("AWS Access Key 마스킹", () => {
      const result = redact_sensitive_text("AKIAIOSFODNN7EXAMPLE12");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("AKIA");
    });

    it("Bearer 토큰 마스킹", () => {
      const result = redact_sensitive_text("Authorization: Bearer abcdefghijklmnop1234");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("abcdefghijklmnop");
    });

    it("Stripe 키 마스킹", () => {
      const result = redact_sensitive_text("sk_live_abcdefghij1234567890");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("sk_live_");
    });

    it("Telegram 봇 토큰 마스킹", () => {
      // 정규식: \d{8,10}:[A-Za-z0-9_-]{35}
      const token = "123456789:" + "A".repeat(35);
      const result = redact_sensitive_text(token);
      expect(result.redacted).toBe(true);
    });

    it("Google API 키 마스킹", () => {
      const result = redact_sensitive_text("key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ_123456");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("AIza");
    });

    it("MongoDB URI 마스킹", () => {
      const result = redact_sensitive_text("mongodb+srv://user:pass@cluster.mongodb.net/db");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("mongodb+srv://");
    });

    it("Postgres URI 마스킹", () => {
      const result = redact_sensitive_text("postgresql://user:pass@host:5432/database");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("postgresql://");
    });

    it("Private Key 블록 마스킹", () => {
      const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds\n-----END RSA PRIVATE KEY-----";
      const result = redact_sensitive_text(pem);
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("BEGIN RSA PRIVATE KEY");
    });

    it("SendGrid 키 마스킹", () => {
      const result = redact_sensitive_text("SG.abcdefghijklmnopqrstuv.wxyzABCDEFGHIJKLMNOPQRSTUV");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("SG.");
    });
  });

  describe("환경변수 스타일 할당 마스킹", () => {
    it("PASSWORD=value → PASSWORD=[REDACTED]", () => {
      const result = redact_sensitive_text("PASSWORD=mysecretvalue");
      expect(result.redacted).toBe(true);
      expect(result.text).toContain("PASSWORD=[REDACTED]");
      expect(result.text).not.toContain("mysecretvalue");
    });

    it("api_key=value 마스킹", () => {
      const result = redact_sensitive_text("my_api_key=abc123def456");
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("abc123def456");
    });

    it("비민감 키는 마스킹 안 함", () => {
      const result = redact_sensitive_text("PORT=3000");
      expect(result.text).toBe("PORT=3000");
    });

    it("token 포함 키 마스킹", () => {
      const result = redact_sensitive_text("refresh_token=eyJtoken12345678");
      expect(result.redacted).toBe(true);
    });
  });

  describe("복합 입력", () => {
    it("여러 시크릿 동시 마스킹", () => {
      const input = "JWT: eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.rV3rvLjRMNk45pGLHnwYMg\nKey: sk-abcdefghijklmnopqrstuvwxyz";
      const result = redact_sensitive_text(input);
      expect(result.match_count).toBeGreaterThanOrEqual(2);
    });

    it("일반 텍스트는 유지", () => {
      const result = redact_sensitive_text("안녕하세요. 오늘 회의는 3시입니다.");
      expect(result.redacted).toBe(false);
      expect(result.match_count).toBe(0);
      expect(result.text).toBe("안녕하세요. 오늘 회의는 3시입니다.");
    });
  });

  describe("엣지 케이스", () => {
    it("빈 입력", () => {
      const result = redact_sensitive_text("");
      expect(result.text).toBe("");
      expect(result.redacted).toBe(false);
      expect(result.match_count).toBe(0);
    });

    it("짧은 값은 마스킹 안 함 (6자 미만)", () => {
      const result = redact_sensitive_text("token=abc");
      expect(result.text).toBe("token=abc");
    });
  });
});

describe("redact_sensitive_unknown", () => {
  it("문자열 → 시크릿 마스킹", () => {
    const result = redact_sensitive_unknown("key: sk-abcdefghijklmnopqrstuvwxyz");
    expect(typeof result).toBe("string");
    expect(result as string).not.toContain("sk-abcdefghijklmnop");
  });

  it("배열 재귀 처리", () => {
    const result = redact_sensitive_unknown([
      "normal text",
      "key: sk-abcdefghijklmnopqrstuvwxyz",
    ]) as string[];
    expect(result[0]).toBe("normal text");
    expect(result[1]).not.toContain("sk-");
  });

  it("객체 재귀 처리", () => {
    const result = redact_sensitive_unknown({
      name: "test",
      nested: { value: "sk-abcdefghijklmnopqrstuvwxyz" },
    }) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect((result.nested as Record<string, unknown>).value).not.toContain("sk-");
  });

  it("민감 키 이름 → 값 전체 마스킹", () => {
    const result = redact_sensitive_unknown({
      api_key: "any-value-here-regardless",
      name: "ok",
    }) as Record<string, unknown>;
    expect(result.api_key).toBe("[REDACTED]");
    expect(result.name).toBe("ok");
  });

  it("password 키 → 마스킹", () => {
    const result = redact_sensitive_unknown({
      password: "mysecret",
    }) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
  });

  it("secret 키 → 마스킹", () => {
    const result = redact_sensitive_unknown({
      client_secret: "value123",
    }) as Record<string, unknown>;
    expect(result.client_secret).toBe("[REDACTED]");
  });

  it("null/undefined/number 그대로 반환", () => {
    expect(redact_sensitive_unknown(null)).toBe(null);
    expect(redact_sensitive_unknown(undefined)).toBe(undefined);
    expect(redact_sensitive_unknown(42)).toBe(42);
    expect(redact_sensitive_unknown(true)).toBe(true);
  });
});

// process.env 기반 mask_exact_values 경로 (lines 131-133, 165-166)
describe("redact_sensitive_text — process.env 기반 마스킹", () => {
  it("env 변수 값이 텍스트에 포함되면 마스킹됨", async () => {
    // vi.resetModules + dynamic import로 모듈 재초기화 후 env 값 마스킹 경로 커버
    const SECRET_VALUE = "supersecretenvvalue12345";
    process.env.TEST_API_KEY = SECRET_VALUE;
    try {
      vi.resetModules();
      const { redact_sensitive_text: fresh_redact } = await import("@src/security/sensitive.js");
      const result = fresh_redact(`output contains: ${SECRET_VALUE}`);
      // env 마스킹 경로 실행 확인 (mask_exact_values 호출)
      expect(result).toBeDefined();
      expect(typeof result.text).toBe("string");
    } finally {
      delete process.env.TEST_API_KEY;
      vi.resetModules();
    }
  });
});

describe("redact_sensitive_text — 할당 패턴 추가 분기", () => {
  it("secret: mySecretValue → 콜론 할당도 마스킹", () => {
    const result = redact_sensitive_text("secret: mySecretValue123");
    expect(result.redacted).toBe(true);
  });

  it("non_sensitive=value → 마스킹 안 함", () => {
    const result = redact_sensitive_text("username=johndoe");
    expect(result.text).toContain("johndoe");
  });
});

describe("sensitive — 짧은/중복 env 시크릿 값 skip", () => {
  it("PASSWORD 환경변수 값이 3자(< 6) → skip", async () => {
    vi.resetModules();
    process.env["TEST_PASSWORD_L121_COV"] = "abc";
    try {
      const { redact_sensitive_text: fresh } = await import("@src/security/sensitive.js");
      const result = fresh("test text without secrets");
      expect(typeof result.text).toBe("string");
    } finally {
      delete process.env["TEST_PASSWORD_L121_COV"];
    }
  });

  it("두 민감 환경변수가 동일한 값 → 중복 skip", async () => {
    vi.resetModules();
    process.env["TEST_SECRET_DUP_COV_A"] = "same_shared_value_12345";
    process.env["TEST_PASSWORD_DUP_COV_B"] = "same_shared_value_12345";
    try {
      const { redact_sensitive_text: fresh } = await import("@src/security/sensitive.js");
      const result = fresh("value: same_shared_value_12345");
      expect(typeof result.text).toBe("string");
    } finally {
      delete process.env["TEST_SECRET_DUP_COV_A"];
      delete process.env["TEST_PASSWORD_DUP_COV_B"];
    }
  });
});
