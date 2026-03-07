import { describe, it, expect } from "vitest";
import { validate_url, normalize_headers, serialize_body } from "@src/agent/tools/http-utils.js";

// ── validate_url ──

describe("validate_url", () => {
  it("유효한 https URL → URL 객체 반환", () => {
    const result = validate_url("https://example.com/api");
    expect(result).toBeInstanceOf(URL);
    expect((result as URL).href).toBe("https://example.com/api");
  });

  it("유효한 http URL", () => {
    const result = validate_url("http://api.example.com:8080/path");
    expect(result).toBeInstanceOf(URL);
  });

  it("빈 문자열 → 에러", () => {
    expect(validate_url("")).toBe("url is required");
  });

  it("잘못된 URL → 에러", () => {
    const result = validate_url("not-a-url");
    expect(typeof result).toBe("string");
    expect(result).toContain("invalid URL");
  });

  it("ftp 프로토콜 → 거부", () => {
    const result = validate_url("ftp://files.example.com/data");
    expect(typeof result).toBe("string");
    expect(result).toContain("unsupported protocol");
  });

  it("file 프로토콜 → 거부", () => {
    const result = validate_url("file:///etc/passwd");
    expect(typeof result).toBe("string");
    expect(result).toContain("unsupported protocol");
  });

  // SSRF 방지: 사설 네트워크
  it("localhost → 차단", () => {
    const result = validate_url("http://localhost/api");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("127.0.0.1 → 차단", () => {
    const result = validate_url("http://127.0.0.1:3000/api");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("10.x.x.x → 차단", () => {
    const result = validate_url("http://10.0.0.5/internal");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("192.168.x.x → 차단", () => {
    const result = validate_url("http://192.168.1.1/admin");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("172.16-31.x.x → 차단", () => {
    expect(typeof validate_url("http://172.16.0.1/")).toBe("string");
    expect(typeof validate_url("http://172.31.255.255/")).toBe("string");
  });

  it("172.15.x.x → 허용 (사설 아님)", () => {
    const result = validate_url("http://172.15.0.1/");
    expect(result).toBeInstanceOf(URL);
  });

  it("172.32.x.x → 허용 (사설 아님)", () => {
    const result = validate_url("http://172.32.0.1/");
    expect(result).toBeInstanceOf(URL);
  });

  it("169.254.x.x → 차단 (link-local)", () => {
    const result = validate_url("http://169.254.169.254/latest/meta-data/");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("0.0.0.0 → 차단", () => {
    const result = validate_url("http://0.0.0.0/");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("::1 → 차단", () => {
    const result = validate_url("http://[::1]/api");
    expect(typeof result).toBe("string");
    expect(result).toContain("private/loopback");
  });

  it("공개 IP → 허용", () => {
    const result = validate_url("https://8.8.8.8/dns-query");
    expect(result).toBeInstanceOf(URL);
  });
});

// ── normalize_headers ──

describe("normalize_headers", () => {
  it("객체를 Record<string, string>으로 변환", () => {
    const result = normalize_headers({ "Content-Type": "application/json", "X-Custom": 42 });
    expect(result).toEqual({ "Content-Type": "application/json", "X-Custom": "42" });
  });

  it("null/undefined → 빈 객체", () => {
    expect(normalize_headers(null)).toEqual({});
    expect(normalize_headers(undefined)).toEqual({});
  });

  it("배열 → 빈 객체", () => {
    expect(normalize_headers([1, 2, 3])).toEqual({});
  });

  it("문자열 → 빈 객체", () => {
    expect(normalize_headers("not-an-object")).toEqual({});
  });

  it("null 값을 빈 문자열로 변환", () => {
    const result = normalize_headers({ "X-Empty": null });
    expect(result["X-Empty"]).toBe("");
  });
});

// ── serialize_body ──

describe("serialize_body", () => {
  it("undefined → undefined 반환", () => {
    const headers: Record<string, string> = {};
    expect(serialize_body(undefined, headers)).toBeUndefined();
  });

  it("null → undefined 반환", () => {
    const headers: Record<string, string> = {};
    expect(serialize_body(null, headers)).toBeUndefined();
  });

  it("문자열 → 그대로 반환, Content-Type 미설정", () => {
    const headers: Record<string, string> = {};
    expect(serialize_body("raw body", headers)).toBe("raw body");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("객체 → JSON 직렬화 + Content-Type 자동 설정", () => {
    const headers: Record<string, string> = {};
    const result = serialize_body({ key: "value" }, headers);
    expect(result).toBe('{"key":"value"}');
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("이미 Content-Type 설정됨 → 덮어쓰지 않음", () => {
    const headers: Record<string, string> = { "content-type": "text/xml" };
    const result = serialize_body({ data: 1 }, headers);
    expect(result).toBe('{"data":1}');
    expect(headers["content-type"]).toBe("text/xml");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("배열 → JSON 직렬화", () => {
    const headers: Record<string, string> = {};
    const result = serialize_body([1, 2, 3], headers);
    expect(result).toBe("[1,2,3]");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
