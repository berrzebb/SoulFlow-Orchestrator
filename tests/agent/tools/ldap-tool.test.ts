/**
 * LdapTool — node:net mock 기반 커버리지.
 * LDAP bind/search/info + BER 파싱 경로.
 */
import { describe, it, expect, vi } from "vitest";

// ── mock 상태 ─────────────────────────────────────────
const { ldap_state } = vi.hoisted(() => ({
  ldap_state: {
    emit_error: false,
    error_msg: "ECONNREFUSED",
    // bind 응답: 마지막 3바이트 패턴 (0x0A, ?, 0x00) → success
    bind_success: true,
    // search 응답에 0x65(SearchResultDone) 포함 여부
    send_search_result: true,
  },
}));

vi.mock("node:net", () => ({
  createConnection: (_port: unknown, _host: unknown, cb?: () => void) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const socket = {
      write: (_data: unknown) => {
        // 각 write 후 데이터 응답 시뮬레이션
        return true;
      },
      destroy: vi.fn(),
      once: (event: string, fn: (...a: unknown[]) => void) => {
        (handlers[event] ||= []).push(fn);
        return socket;
      },
      on: (event: string, fn: (...a: unknown[]) => void) => {
        (handlers[event] ||= []).push(fn);
        return socket;
      },
    };

    // 비동기로 이벤트 발생
    Promise.resolve().then(() => {
      if (ldap_state.emit_error) {
        (handlers["error"] || []).forEach(fn => fn(new Error(ldap_state.error_msg)));
        return;
      }

      // connect 콜백 호출
      if (cb) cb();

      // bind 응답 (once("data"))
      Promise.resolve().then(() => {
        // LDAP BindResponse: 성공 시 마지막 3바이트가 [0x0A, ?, 0x00]
        const bind_resp = ldap_state.bind_success
          ? Buffer.from([0x30, 0x0C, 0x02, 0x01, 0x01, 0x61, 0x07, 0x0A, 0x01, 0x00, 0x04, 0x00, 0x0A, 0x01, 0x00])
          : Buffer.from([0x30, 0x0C, 0x02, 0x01, 0x01, 0x61, 0x07, 0x0A, 0x01, 0x31, 0x04, 0x00, 0x04, 0x00, 0x01]);
        (handlers["data"] || []).forEach(fn => fn(bind_resp));

        // search 응답 (on("data") 두 번째 이후)
        if (ldap_state.send_search_result) {
          Promise.resolve().then(() => {
            // 0x65 = SearchResultDone
            const search_done = Buffer.from([0x30, 0x07, 0x02, 0x01, 0x02, 0x65, 0x02, 0x0A, 0x00]);
            (handlers["data"] || []).forEach(fn => fn(search_done));
          });
        }
      });
    });

    return socket as any;
  },
}));

import { LdapTool } from "@src/agent/tools/ldap.js";

function make_tool() { return new LdapTool(); }

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("LdapTool — 메타데이터", () => {
  it("name = ldap", () => expect(make_tool().name).toBe("ldap"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("LdapTool — 파라미터 검증", () => {
  it("host 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "search", host: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("host");
  });
});

// ══════════════════════════════════════════
// info action
// ══════════════════════════════════════════

describe("LdapTool — info action", () => {
  it("info → host/port/note 반환", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "info",
      host: "ldap.example.com",
      port: 389,
    }));
    expect(r.host).toBe("ldap.example.com");
    expect(r.port).toBe(389);
    expect(r.note).toBeTruthy();
  });

  it("기본 포트 (389)", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "info",
      host: "ldap.example.com",
    }));
    expect(r.port).toBe(389);
  });
});

// ══════════════════════════════════════════
// bind action
// ══════════════════════════════════════════

describe("LdapTool — bind", () => {
  it("bind 성공", async () => {
    ldap_state.emit_error = false;
    ldap_state.bind_success = true;
    const r = JSON.parse(await make_tool().execute({
      action: "bind",
      host: "ldap.example.com",
      bind_dn: "cn=admin,dc=example,dc=com",
      password: "secret",
    }));
    expect(r.success).toBe(true);
    expect(r.message).toContain("successful");
  });

  it("bind 실패 (잘못된 자격증명)", async () => {
    ldap_state.emit_error = false;
    ldap_state.bind_success = false;
    const r = JSON.parse(await make_tool().execute({
      action: "bind",
      host: "ldap.example.com",
      bind_dn: "cn=user",
      password: "wrong",
    }));
    expect(r.success).toBe(false);
    expect(r.message).toContain("failed");
  });

  it("연결 오류 → success=false", async () => {
    ldap_state.emit_error = true;
    ldap_state.error_msg = "ECONNREFUSED";
    const r = JSON.parse(await make_tool().execute({
      action: "bind",
      host: "ldap.example.com",
      bind_dn: "cn=admin",
      password: "pass",
    }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
    ldap_state.emit_error = false;
    ldap_state.bind_success = true;
  });
});

// ══════════════════════════════════════════
// search action
// ══════════════════════════════════════════

describe("LdapTool — search", () => {
  it("search 성공 → response_size 포함", async () => {
    ldap_state.emit_error = false;
    ldap_state.bind_success = true;
    ldap_state.send_search_result = true;
    const r = JSON.parse(await make_tool().execute({
      action: "search",
      host: "ldap.example.com",
      bind_dn: "cn=admin,dc=example,dc=com",
      password: "secret",
      base_dn: "dc=example,dc=com",
      filter: "(objectClass=person)",
      scope: "sub",
      attributes: "cn,mail",
    }));
    expect(r.success).toBe(true);
    expect(r.response_size).toBeGreaterThan(0);
    expect(r.base_dn).toBe("dc=example,dc=com");
    expect(r.filter).toBe("(objectClass=person)");
  });

  it("scope=base", async () => {
    ldap_state.send_search_result = true;
    const r = JSON.parse(await make_tool().execute({
      action: "search",
      host: "ldap.example.com",
      base_dn: "cn=user,dc=example,dc=com",
      scope: "base",
    }));
    expect(r.success).toBe(true);
  });

  it("scope=one", async () => {
    ldap_state.send_search_result = true;
    const r = JSON.parse(await make_tool().execute({
      action: "search",
      host: "ldap.example.com",
      base_dn: "ou=users,dc=example,dc=com",
      scope: "one",
    }));
    expect(r.success).toBe(true);
  });

  it("연결 오류 → success=false", async () => {
    ldap_state.emit_error = true;
    const r = JSON.parse(await make_tool().execute({
      action: "search",
      host: "ldap.example.com",
      base_dn: "dc=example,dc=com",
    }));
    expect(r.success).toBe(false);
    ldap_state.emit_error = false;
  });

  it("attributes 없음 → 기본값 사용", async () => {
    ldap_state.send_search_result = true;
    const r = JSON.parse(await make_tool().execute({
      action: "search",
      host: "ldap.example.com",
      base_dn: "dc=example,dc=com",
    }));
    expect(r.success).toBe(true);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("LdapTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus", host: "ldap.example.com" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
