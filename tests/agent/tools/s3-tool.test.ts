/**
 * S3Tool — fetch mock 기반 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { S3Tool } from "@src/agent/tools/s3.js";

function make_tool() { return new S3Tool(); }

const CREDS = {
  bucket: "my-bucket",
  access_key: "AKIAIOSFODNN7EXAMPLE",
  secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

function mock_ok(body: string, status = 200) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(body, { status }),
  );
}

function mock_fail(status: number, body = "error") {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(body, { status }),
  );
}

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("S3Tool — 메타데이터", () => {
  it("name = s3", () => expect(make_tool().name).toBe("s3"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("S3Tool — 파라미터 검증", () => {
  it("bucket 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "list", bucket: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bucket");
  });

  it("access_key/secret_key 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "list", bucket: "test" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("access_key");
  });
});

// ══════════════════════════════════════════
// list
// ══════════════════════════════════════════

describe("S3Tool — list", () => {
  it("성공 → XML 반환", async () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><Name>my-bucket</Name><Contents><Key>file.txt</Key></Contents></ListBucketResult>`;
    mock_ok(xml);
    const r = await make_tool().execute({ action: "list", ...CREDS });
    expect(r).toContain("file.txt");
  });

  it("prefix 지정", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<List/>", { status: 200 }));
    await make_tool().execute({ action: "list", ...CREDS, prefix: "data/", max_keys: 50 });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("prefix=data%2F");
    expect(url).toContain("max-keys=50");
  });

  it("HTTP 오류 → Error 반환", async () => {
    mock_fail(403, "<Error>Access Denied</Error>");
    const r = await make_tool().execute({ action: "list", ...CREDS });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("403");
  });
});

// ══════════════════════════════════════════
// get
// ══════════════════════════════════════════

describe("S3Tool — get", () => {
  it("성공 → 내용 반환 (50000자 제한)", async () => {
    mock_ok("hello world content");
    const r = await make_tool().execute({ action: "get", ...CREDS, key: "file.txt" });
    expect(r).toContain("hello world content");
  });

  it("네트워크 오류 → Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
    const r = await make_tool().execute({ action: "get", ...CREDS, key: "file.txt" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("network error");
  });
});

// ══════════════════════════════════════════
// put
// ══════════════════════════════════════════

describe("S3Tool — put", () => {
  it("body 문자열로 업로드", async () => {
    mock_ok("");
    const r = JSON.parse(await make_tool().execute({
      action: "put", ...CREDS,
      key: "test.txt",
      body: "content here",
    }));
    expect(r.success).toBe(true);
    expect(r.key).toBe("test.txt");
    expect(r.size).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// delete
// ══════════════════════════════════════════

describe("S3Tool — delete", () => {
  it("성공 → deleted 반환", async () => {
    mock_ok("");
    const r = JSON.parse(await make_tool().execute({
      action: "delete", ...CREDS, key: "old-file.txt",
    }));
    expect(r.success).toBe(true);
    expect(r.deleted).toBe("old-file.txt");
  });
});

// ══════════════════════════════════════════
// head
// ══════════════════════════════════════════

describe("S3Tool — head", () => {
  it("성공 → status/headers 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: { "content-length": "1234", "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT" },
      }),
    );
    const r = JSON.parse(await make_tool().execute({
      action: "head", ...CREDS, key: "object.txt",
    }));
    expect(r.status).toBe(200);
    expect(r.headers).toBeDefined();
  });
});

// ══════════════════════════════════════════
// presign
// ══════════════════════════════════════════

describe("S3Tool — presign", () => {
  it("presign → note + url 반환 (fetch 없음)", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "presign", ...CREDS,
      key: "private/doc.pdf",
      expires_in: 7200,
    }));
    expect(r.note).toBeTruthy();
    expect(r.url).toContain("my-bucket");
    expect(r.expires_in).toBe(7200);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("S3Tool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus", ...CREDS });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
