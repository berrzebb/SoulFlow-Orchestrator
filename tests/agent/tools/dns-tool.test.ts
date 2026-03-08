/**
 * DnsTool — node:dns mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_dns } = vi.hoisted(() => ({
  mock_dns: {
    lookup: vi.fn(),
    reverse: vi.fn(),
    resolveMx: vi.fn(),
    resolveTxt: vi.fn(),
    resolveNs: vi.fn(),
    resolveCname: vi.fn(),
    resolveSrv: vi.fn(),
    resolveAny: vi.fn(),
  },
}));

vi.mock("node:dns", () => ({
  promises: mock_dns,
}));

import { DnsTool } from "@src/agent/tools/dns.js";

function make_tool() { return new DnsTool(); }

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("DnsTool — 메타데이터", () => {
  it("name = dns", () => expect(make_tool().name).toBe("dns"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("DnsTool — 파라미터 검증", () => {
  it("host 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "lookup", host: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("host");
  });

  it("unsupported action → Error", async () => {
    const r = await make_tool().execute({ action: "bogus", host: "example.com" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});

// ══════════════════════════════════════════
// lookup
// ══════════════════════════════════════════

describe("DnsTool — lookup", () => {
  it("성공 → addresses 포함", async () => {
    mock_dns.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const r = JSON.parse(await make_tool().execute({ action: "lookup", host: "example.com" }));
    expect(r.host).toBe("example.com");
    expect(Array.isArray(r.addresses)).toBe(true);
  });

  it("family=6 지정", async () => {
    mock_dns.lookup.mockResolvedValueOnce([{ address: "2606:2800::1", family: 6 }]);
    const r = JSON.parse(await make_tool().execute({ action: "lookup", host: "example.com", family: 6 }));
    expect(r.addresses[0].family).toBe(6);
  });

  it("오류 → Error 반환", async () => {
    mock_dns.lookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const r = await make_tool().execute({ action: "lookup", host: "notexist.invalid" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("ENOTFOUND");
  });
});

// ══════════════════════════════════════════
// reverse
// ══════════════════════════════════════════

describe("DnsTool — reverse", () => {
  it("성공 → hostnames 반환", async () => {
    mock_dns.reverse.mockResolvedValueOnce(["one.one.one.one"]);
    const r = JSON.parse(await make_tool().execute({ action: "reverse", host: "1.1.1.1" }));
    expect(r.ip).toBe("1.1.1.1");
    expect(r.hostnames).toContain("one.one.one.one");
  });
});

// ══════════════════════════════════════════
// mx
// ══════════════════════════════════════════

describe("DnsTool — mx", () => {
  it("성공 → priority 정렬된 mx 반환", async () => {
    mock_dns.resolveMx.mockResolvedValueOnce([
      { exchange: "mx2.example.com", priority: 20 },
      { exchange: "mx1.example.com", priority: 10 },
    ]);
    const r = JSON.parse(await make_tool().execute({ action: "mx", host: "example.com" }));
    expect(r.mx[0].priority).toBe(10);
    expect(r.mx[1].priority).toBe(20);
  });
});

// ══════════════════════════════════════════
// txt
// ══════════════════════════════════════════

describe("DnsTool — txt", () => {
  it("성공 → txt 배열 반환", async () => {
    mock_dns.resolveTxt.mockResolvedValueOnce([["v=spf1", "include:example.com", "~all"]]);
    const r = JSON.parse(await make_tool().execute({ action: "txt", host: "example.com" }));
    expect(r.txt[0]).toContain("v=spf1");
  });
});

// ══════════════════════════════════════════
// ns
// ══════════════════════════════════════════

describe("DnsTool — ns", () => {
  it("성공 → ns 배열 반환", async () => {
    mock_dns.resolveNs.mockResolvedValueOnce(["ns1.example.com", "ns2.example.com"]);
    const r = JSON.parse(await make_tool().execute({ action: "ns", host: "example.com" }));
    expect(r.ns).toContain("ns1.example.com");
  });
});

// ══════════════════════════════════════════
// cname
// ══════════════════════════════════════════

describe("DnsTool — cname", () => {
  it("성공 → cname 배열 반환", async () => {
    mock_dns.resolveCname.mockResolvedValueOnce(["canonical.example.com"]);
    const r = JSON.parse(await make_tool().execute({ action: "cname", host: "www.example.com" }));
    expect(r.cname).toContain("canonical.example.com");
  });
});

// ══════════════════════════════════════════
// srv
// ══════════════════════════════════════════

describe("DnsTool — srv", () => {
  it("성공 → srv 배열 반환", async () => {
    mock_dns.resolveSrv.mockResolvedValueOnce([{ name: "sip.example.com", port: 5060, priority: 10, weight: 20 }]);
    const r = JSON.parse(await make_tool().execute({ action: "srv", host: "_sip._tcp.example.com" }));
    expect(r.srv[0].port).toBe(5060);
  });
});

// ══════════════════════════════════════════
// any
// ══════════════════════════════════════════

describe("DnsTool — any", () => {
  it("성공 → records 배열 반환", async () => {
    mock_dns.resolveAny.mockResolvedValueOnce([{ type: "A", address: "1.2.3.4", ttl: 300 }]);
    const r = JSON.parse(await make_tool().execute({ action: "any", host: "example.com" }));
    expect(r.records[0].type).toBe("A");
  });
});
