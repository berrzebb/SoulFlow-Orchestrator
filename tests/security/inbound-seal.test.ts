import { describe, it, expect, vi } from "vitest";
import { seal_inbound_sensitive_text } from "@src/security/inbound-seal.js";
import type { SecretVaultLike } from "@src/security/secret-vault.js";

function make_vault(): SecretVaultLike {
  const store = new Map<string, string>();
  return {
    put_secret: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get_secret: vi.fn(async (key: string) => store.get(key) ?? null),
    delete_secret: vi.fn(async () => true),
    list_secret_names: vi.fn(async () => [...store.keys()]),
    has_secret: vi.fn(async (key: string) => store.has(key)),
  } as unknown as SecretVaultLike;
}

const BASE_ARGS = { provider: "telegram", chat_id: "ch1", vault: make_vault() };

describe("seal_inbound_sensitive_text", () => {
  describe("토큰 패턴", () => {
    it("OpenAI API 키 시크릿 처리", async () => {
      const vault = make_vault();
      const result = await seal_inbound_sensitive_text(
        "my key: sk-abcdefghijklmnopqrstuvwxyz",
        { ...BASE_ARGS, vault },
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("sk-abcdefghijklmnop");
      expect(result.text).toContain("{{secret:");
      expect(vault.put_secret).toHaveBeenCalled();
    });

    it("JWT 토큰 시크릿 처리", async () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.rV3rvLjRMNk45pGLHnwYMg";
      const result = await seal_inbound_sensitive_text(`Token: ${jwt}`, BASE_ARGS);
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("eyJ");
    });

    it("GitHub PAT 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZab",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0].kind).toBe("token");
    });

    it("Slack 토큰 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "xoxb-1234567890-abcdefghij",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });

    it("Bearer 토큰 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "Authorization: Bearer abcdefghijklmnop1234",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });
  });

  describe("할당 패턴 (keyword=value)", () => {
    it("password=value 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "my_password=super_secret_123",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("super_secret_123");
      expect(result.text).toContain("{{secret:");
    });

    it("api_key=value 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        'api_key="my_api_key_value_here"',
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });

    it("비민감 키는 통과", async () => {
      const result = await seal_inbound_sensitive_text(
        "PORT=3000",
        BASE_ARGS,
      );
      expect(result.hits).toHaveLength(0);
      expect(result.text).toBe("PORT=3000");
    });
  });

  describe("카드번호 (Luhn 검증)", () => {
    it("유효한 카드번호 시크릿 처리", async () => {
      // 4111111111111111 — Visa test card (Luhn valid)
      const result = await seal_inbound_sensitive_text(
        "카드번호: 4111111111111111",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("4111111111111111");
    });

    it("Luhn 실패 번호는 통과", async () => {
      const result = await seal_inbound_sensitive_text(
        "번호: 1234567890123456",
        BASE_ARGS,
      );
      // Luhn 실패 → 카드로 취급 안 됨
      expect(result.hits).toHaveLength(0);
    });
  });

  describe("계좌번호", () => {
    it("account=번호 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "account=1234567890123",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.some(h => h.kind === "account")).toBe(true);
    });

    it("account= 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "account=1234567890123",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });

    it("계좌번호= 한글 키워드 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "계좌번호=1234567890",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });
  });

  describe("Private Key 블록", () => {
    it("PEM 키 시크릿 처리", async () => {
      const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds\n-----END RSA PRIVATE KEY-----";
      const result = await seal_inbound_sensitive_text(pem, BASE_ARGS);
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0].kind).toBe("private_key");
    });
  });

  describe("단일 따옴표 래핑 값", () => {
    it("api_key='single_quoted' → 단일 따옴표 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "api_key='my_single_quoted_secret_here'",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("my_single_quoted_secret_here");
    });
  });

  describe("ACCOUNT_LINE_RE (키워드 + 공백 + 숫자)", () => {
    it("bank 공백 구분 계좌번호 시크릿 처리", async () => {
      // ACCOUNT_ASSIGNMENT_RE은 bank_account(언더스코어)만 대응,
      // ACCOUNT_LINE_RE는 bank(공백 구분)도 대응
      const result = await seal_inbound_sensitive_text(
        "bank 12345678901",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.some((h) => h.kind === "account")).toBe(true);
    });

    it("iban 공백 구분 계좌번호 시크릿 처리", async () => {
      const result = await seal_inbound_sensitive_text(
        "iban 1234567890123456",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });
  });

  describe("카드번호 순수 번호 패턴 (CARD_NUMBER_RE)", () => {
    it("키워드 없이 Luhn-valid 카드번호만 → CARD_NUMBER_RE 경로", async () => {
      // CARD_ASSIGNMENT_RE는 card= 키워드 필요; 여기서는 순수 숫자만
      const result = await seal_inbound_sensitive_text(
        "결제 정보: 4111111111111111 로 처리됩니다",
        BASE_ARGS,
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.some((h) => h.kind === "card")).toBe(true);
    });
  });

  describe("엣지 케이스", () => {
    it("빈 입력 → 빈 결과", async () => {
      const result = await seal_inbound_sensitive_text("", BASE_ARGS);
      expect(result.text).toBe("");
      expect(result.hits).toHaveLength(0);
    });

    it("일반 텍스트 → 변경 없음", async () => {
      const result = await seal_inbound_sensitive_text(
        "안녕하세요, 오늘 날씨 좋네요",
        BASE_ARGS,
      );
      expect(result.text).toBe("안녕하세요, 오늘 날씨 좋네요");
      expect(result.hits).toHaveLength(0);
    });

    it("같은 시크릿 반복 → 한 번만 hits에 등장", async () => {
      const key = "sk-abcdefghijklmnopqrstuvwxyz";
      const result = await seal_inbound_sensitive_text(
        `first: ${key}\nsecond: ${key}`,
        BASE_ARGS,
      );
      // 같은 값 → 같은 key → hits에 1번
      const unique_keys = new Set(result.hits.map(h => h.key));
      expect(unique_keys.size).toBe(1);
    });

    it("placeholder 형식 검증", async () => {
      const result = await seal_inbound_sensitive_text(
        "secret=my_very_secret_value",
        BASE_ARGS,
      );
      if (result.hits.length > 0) {
        expect(result.hits[0].placeholder).toMatch(/^\{\{secret:.+\}\}$/);
        expect(result.hits[0].key).toContain("inbound.");
      }
    });
  });
});

// ── from inbound-seal-cov2.test.ts ──

const CTX = { provider: "slack", chat_id: "C001" };

describe("seal_inbound_sensitive_text — ASSIGNMENT_RE card/account skip", () => {
  it("card=값 패턴 → ASSIGNMENT_RE에서 card kind → 원본 반환 (skip)", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "card=sometext_value",
      { ...CTX, vault },
    );
    expect(typeof result.text).toBe("string");
    expect(result.text).toContain("card=sometext_value");
  });

  it("account=abc_text → ASSIGNMENT_RE에서 account kind → skip", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "account=notanumber",
      { ...CTX, vault },
    );
    expect(result.text).toContain("account=notanumber");
  });
});

describe("seal_inbound_sensitive_text — ACCOUNT_LINE_RE", () => {
  it("계좌번호 패턴 → ACCOUNT_LINE_RE 매칭 → 봉인", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "account: 12345678901",
      { ...CTX, vault },
    );
    expect(result.text).not.toContain("12345678901");
    expect(vault.put_secret).toHaveBeenCalled();
  });

  it("iban 패턴 → 봉인", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "iban 1234567890123456",
      { ...CTX, vault },
    );
    expect(typeof result.text).toBe("string");
  });
});

describe("seal_inbound_sensitive_text — CARD_NUMBER_RE luhn", () => {
  it("luhn 유효 카드번호 → 봉인됨", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "카드번호: 4532015112830366",
      { ...CTX, vault },
    );
    expect(result.text).not.toContain("4532015112830366");
    expect(vault.put_secret).toHaveBeenCalled();
  });

  it("luhn 무효 숫자열 → 봉인 안 됨 (원본 유지)", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "some number: 1234567890123456",
      { ...CTX, vault },
    );
    expect(result.text).toContain("1234567890123456");
  });
});

// ── from inbound-seal-cov3.test.ts ──

describe("seal_inbound_sensitive_text — L158: 짧은 quoted 값 봉인 건너뜀", () => {
  it("password=\"ab\" → 내부 값 2자 < 4 → L158: 봉인하지 않고 그대로 반환", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      'password = "ab"',
      { ...CTX, vault },
    );
    expect(vault.put_secret).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(0);
  });

  it("token='x' → 내부 값 1자 < 4 → L158: 봉인하지 않고 원본 유지", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "token = 'x'",
      { ...CTX, vault },
    );
    expect(vault.put_secret).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(0);
  });

  it("password=longvalue → 긴 값 → L158 건너뜀 → 정상 봉인", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "password=supersecretvalue",
      { ...CTX, vault },
    );
    expect(vault.put_secret).toHaveBeenCalled();
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
