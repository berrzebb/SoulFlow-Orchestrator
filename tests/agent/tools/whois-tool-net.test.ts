/**
 * WhoisTool — query/parse 네트워크 경로 테스트 (vi.mock으로 node:net 대체).
 */
import { describe, it, expect, vi } from "vitest";

// ── node:net mock ───────────────────────────────────

const { net_state } = vi.hoisted(() => {
  const state = {
    response: "",
    emit_error: false,
    emit_timeout: false,
  };
  return { net_state: state };
});

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown, cb?: () => void) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};

    const emitter = {
      write: () => {},
      destroy: () => {},
      on: (event: string, fn: (...a: unknown[]) => void) => {
        (handlers[event] ||= []).push(fn);
        return emitter;
      },
    };

    Promise.resolve().then(() => {
      if (net_state.emit_error) {
        (handlers["error"] || []).forEach(fn => fn(new Error("ECONNREFUSED")));
        return;
      }
      if (net_state.emit_timeout) {
        (handlers["timeout"] || []).forEach(fn => fn());
        return;
      }
      if (cb) cb();
      Promise.resolve().then(() => {
        (handlers["data"] || []).forEach(fn => fn(Buffer.from(net_state.response, "utf-8")));
        Promise.resolve().then(() => {
          (handlers["end"] || []).forEach(fn => fn());
        });
      });
    });

    return emitter;
  },
}));

// ── import after mock ─────────────────────────────────

const { WhoisTool } = await import("@src/agent/tools/whois.js");

// ── helpers ──────────────────────────────────────────

function set_response(raw: string) {
  net_state.response = raw;
  net_state.emit_error = false;
  net_state.emit_timeout = false;
}

// ══════════════════════════════════════════
// query action
// ══════════════════════════════════════════

describe("WhoisTool — query (net mock)", () => {
  it("WHOIS 응답 파싱: domain_name/registrar/name_servers/status", async () => {
    set_response([
      "Domain Name: EXAMPLE.COM",
      "Registrar: Example Registrar Inc.",
      "Creation Date: 2000-01-01T00:00:00Z",
      "Registry Expiry Date: 2025-01-01T00:00:00Z",
      "Registrant Organization: Example Corp",
      "Registrant Country: US",
      "Name Server: NS1.EXAMPLE.COM",
      "Name Server: NS2.EXAMPLE.COM",
      "Status: clientTransferProhibited https://icann.org/epp",
    ].join("\r\n"));

    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "query", domain: "example.com" }));
    expect(r.domain).toBe("example.com");
    expect(r.domain_name).toBe("EXAMPLE.COM");
    expect(r.registrar).toBe("Example Registrar Inc.");
    expect(r.name_servers).toContain("ns1.example.com");
    expect(r.registered).toBe(true);
    expect(typeof r.raw).toBe("string");
  });

  it("빈 응답 → registered=false", async () => {
    set_response("");
    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "query", domain: "notregistered.xyz" }));
    expect(r.registered).toBe(false);
    expect(r.name_servers).toEqual([]);
  });

  it("네트워크 오류 → raw에 Error 포함", async () => {
    net_state.emit_error = true;
    net_state.response = "";
    net_state.emit_timeout = false;
    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "query", domain: "example.com" }));
    expect(r.raw).toContain("Error");
  });

  it("timeout → raw에 Error: timeout 포함", async () => {
    net_state.emit_timeout = true;
    net_state.emit_error = false;
    net_state.response = "";
    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "query", domain: "example.com" }));
    expect(r.raw).toContain("Error");
  });

  it("서버 override 사용", async () => {
    set_response("Domain Name: TEST.COM\r\n");
    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "query", domain: "test.com", server: "custom.whois.server" }));
    expect(r.server).toBe("custom.whois.server");
  });
});

// ══════════════════════════════════════════
// parse action
// ══════════════════════════════════════════

describe("WhoisTool — parse (net mock)", () => {
  it("parse: 파싱된 데이터만 반환 (raw 없음)", async () => {
    set_response([
      "Domain Name: PARSE.COM",
      "Updated Date: 2023-06-01",
      "Expiration Date: 2026-06-01",
      "Name Server: NS.PARSE.COM",
    ].join("\r\n"));

    const tool = new WhoisTool();
    const r = JSON.parse(await tool.execute({ action: "parse", domain: "parse.com" }));
    expect(r.registered).toBe(true);
    expect(r.name_servers).toContain("ns.parse.com");
    // parse 액션은 raw 포함 안 함
    expect(r.raw).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("WhoisTool — 미커버 분기 (L103)", () => {
  it("parse: 빈 값을 가진 필드 → L103 continue (값 없는 줄 skip)", async () => {
    // "Domain Name: " (빈 값) → value="" → !value → continue
    net_state.response = [
      "Domain Name: ",          // empty value → L103 skip
      "Domain Name: EXAMPLE.COM",
      "Updated Date: 2024-01-01",
    ].join("\r\n");
    const tool = (await import("@src/agent/tools/whois.js")).WhoisTool;
    const t = new tool();
    const r = JSON.parse(await t.execute({ action: "parse", domain: "example.com" }));
    // domain_name is from "Domain Name: EXAMPLE.COM", registered = !!domain_name
    expect(r.registered).toBe(true);
    expect(r.domain_name).toBe("EXAMPLE.COM");
  });
});
