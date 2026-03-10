/**
 * IpTool — parse/validate/cidr_contains/subnet/is_private/is_v6/range/to_int/from_int 테스트.
 */
import { describe, it, expect } from "vitest";
import { IpTool } from "../../../src/agent/tools/ip.js";

const tool = new IpTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("IpTool — parse", () => {
  it("유효한 IPv4 파싱", async () => {
    const r = await exec({ action: "parse", ip: "192.168.1.100" }) as Record<string, unknown>;
    expect(r.version).toBe(4);
    expect(r.is_private).toBe(true);
    expect(Array.isArray(r.octets)).toBe(true);
    expect(r.integer).toBeGreaterThan(0);
  });

  it("공인 IP → is_private: false", async () => {
    const r = await exec({ action: "parse", ip: "8.8.8.8" }) as Record<string, unknown>;
    expect(r.is_private).toBe(false);
    expect(r.version).toBe(4);
  });

  it("잘못된 IPv4 → error", async () => {
    const r = await exec({ action: "parse", ip: "999.999.999.999" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("IPv6 파싱", async () => {
    const r = await exec({ action: "parse", ip: "::1" }) as Record<string, unknown>;
    expect(r.version).toBe(6);
    expect(r.expanded).toBeDefined();
  });
});

describe("IpTool — validate", () => {
  it("유효한 IPv4 → valid: true", async () => {
    const r = await exec({ action: "validate", ip: "10.0.0.1" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.version).toBe(4);
  });

  it("유효한 IPv6 → valid: true, version: 6", async () => {
    const r = await exec({ action: "validate", ip: "2001:db8::1" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.version).toBe(6);
  });

  it("잘못된 IP → valid: false", async () => {
    const r = await exec({ action: "validate", ip: "not.an.ip" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.version).toBeNull();
  });
});

describe("IpTool — cidr_contains", () => {
  it("서브넷 내 IP → contains: true", async () => {
    const r = await exec({ action: "cidr_contains", cidr: "192.168.1.0/24", ip: "192.168.1.100" }) as Record<string, unknown>;
    expect(r.contains).toBe(true);
  });

  it("서브넷 외부 IP → contains: false", async () => {
    const r = await exec({ action: "cidr_contains", cidr: "192.168.1.0/24", ip: "192.168.2.100" }) as Record<string, unknown>;
    expect(r.contains).toBe(false);
  });

  it("잘못된 CIDR 형식 → Error", async () => {
    const r = await exec({ action: "cidr_contains", cidr: "192.168.1.0", ip: "192.168.1.1" });
    expect(String(r)).toContain("Error");
  });
});

describe("IpTool — subnet", () => {
  it("/24 서브넷 정보", async () => {
    const r = await exec({ action: "subnet", cidr: "192.168.1.0/24" }) as Record<string, unknown>;
    expect(r.network).toBe("192.168.1.0");
    expect(r.broadcast).toBe("192.168.1.255");
    expect(r.netmask).toBe("255.255.255.0");
    expect(Number(r.host_count)).toBe(254);
  });

  it("/30 서브넷 (소규모)", async () => {
    const r = await exec({ action: "subnet", cidr: "10.0.0.0/30" }) as Record<string, unknown>;
    expect(Number(r.host_count)).toBe(2);
  });
});

describe("IpTool — is_private", () => {
  it("10.x.x.x → private", async () => {
    const r = await exec({ action: "is_private", ip: "10.1.2.3" }) as Record<string, unknown>;
    expect(r.is_private).toBe(true);
  });

  it("172.16.x.x → private", async () => {
    const r = await exec({ action: "is_private", ip: "172.16.0.1" }) as Record<string, unknown>;
    expect(r.is_private).toBe(true);
  });

  it("8.8.8.8 → not private", async () => {
    const r = await exec({ action: "is_private", ip: "8.8.8.8" }) as Record<string, unknown>;
    expect(r.is_private).toBe(false);
  });

  it("127.0.0.1 → private (loopback)", async () => {
    const r = await exec({ action: "is_private", ip: "127.0.0.1" }) as Record<string, unknown>;
    expect(r.is_private).toBe(true);
  });
});

describe("IpTool — is_v6", () => {
  it("IPv6 → is_v6: true", async () => {
    const r = await exec({ action: "is_v6", ip: "::1" }) as Record<string, unknown>;
    expect(r.is_v6).toBe(true);
  });

  it("IPv4 → is_v6: false", async () => {
    const r = await exec({ action: "is_v6", ip: "192.168.1.1" }) as Record<string, unknown>;
    expect(r.is_v6).toBe(false);
  });
});

describe("IpTool — range", () => {
  it("IP 범위 생성", async () => {
    const r = await exec({ action: "range", start: "192.168.1.1", end: "192.168.1.5" }) as Record<string, unknown>;
    expect((r.ips as string[]).length).toBe(5);
    expect(r.count).toBe(5);
    expect(r.truncated).toBe(false);
  });

  it("256개 초과 → truncated: true", async () => {
    const r = await exec({ action: "range", start: "10.0.0.0", end: "10.0.1.255" }) as Record<string, unknown>;
    expect(r.truncated).toBe(true);
    expect((r.ips as string[]).length).toBe(256);
  });

  it("end 없음 → Error", async () => {
    const r = await exec({ action: "range", start: "10.0.0.1" });
    expect(String(r)).toContain("Error");
  });
});

describe("IpTool — to_int / from_int", () => {
  it("IP → 정수 변환", async () => {
    const r = await exec({ action: "to_int", ip: "0.0.0.1" }) as Record<string, unknown>;
    expect(r.integer).toBe(1);
  });

  it("정수 → IP 변환", async () => {
    const r = await exec({ action: "from_int", value: 1 }) as Record<string, unknown>;
    expect(r.ip).toBe("0.0.0.1");
  });

  it("왕복 변환 (to_int → from_int)", async () => {
    const to = await exec({ action: "to_int", ip: "192.168.1.1" }) as Record<string, unknown>;
    const from = await exec({ action: "from_int", value: to.integer }) as Record<string, unknown>;
    expect(from.ip).toBe("192.168.1.1");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("IpTool — 미커버 분기", () => {
  it("parse: 다중 :: IPv6 → invalid IPv6 (L33+L140)", async () => {
    // expand_v6("::1::2"): split("::") → 3개 → L140 null → L33 error
    const r = await exec({ action: "parse", ip: "::1::2" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid IPv6");
  });

  it("parse: 9그룹 IPv6 → missing<0 → invalid IPv6 (L33+L144)", async () => {
    // expand_v6("1:2:3:4:5:6:7:8:9"): 9 groups, missing=-1 < 0 → L144 null → L33 error
    const r = await exec({ action: "parse", ip: "1:2:3:4:5:6:7:8:9" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid IPv6");
  });

  it("cidr_contains: net_parts.length !== 4 → Error (L56)", async () => {
    // "10.0.0/24" → net_parts 3개 → only IPv4 supported error
    const r = await exec({ action: "cidr_contains", cidr: "10.0.0/24", ip: "10.0.0.1" });
    expect(String(r)).toContain("Error");
  });

  it("subnet: cidr에 / 없음 → Error (L66)", async () => {
    const r = await exec({ action: "subnet", cidr: "192.168.1.0" });
    expect(String(r)).toContain("Error");
  });

  it("unsupported action → Error (L114)", async () => {
    const r = await exec({ action: "lookup", ip: "1.2.3.4" });
    expect(String(r)).toContain("Error");
  });
});
