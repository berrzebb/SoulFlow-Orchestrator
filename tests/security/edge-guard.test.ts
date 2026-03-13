/**
 * SH-1 Edge Guard 회귀 테스트.
 * - body size limit (1MB 기본값, 413 반환)
 * - webhook secret 인증 (accept/reject)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ServerResponse, IncomingMessage } from "node:http";

// ── DashboardService body size limit 테스트 ──────────────
// _read_json_body는 private이므로, 동일 로직을 추출하여 테스트

/** _read_json_body와 동일한 구조. DashboardService.ts L188-215 미러. */
function read_json_body(
  req: IncomingMessage,
  res: ServerResponse,
  max_bytes = 1_048_576,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > max_bytes) {
        req.destroy();
        if (!res.headersSent) {
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "payload_too_large" }));
        }
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function make_mock_req(): EventEmitter & { destroy: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  emitter.destroy = vi.fn(() => { emitter.removeAllListeners(); });
  return emitter;
}

function make_mock_res(): { statusCode: number; headers: Record<string, string>; body: string; headersSent: boolean; setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    headersSent: false,
    setHeader: vi.fn((k: string, v: string) => { res.headers[k] = v; }),
    end: vi.fn((data?: string) => { res.body = data ?? ""; res.headersSent = true; }),
  };
  return res;
}

describe("SH-1: body size limit", () => {
  it("정상 크기 요청 → 파싱 성공", async () => {
    const req = make_mock_req();
    const res = make_mock_res();
    const promise = read_json_body(req as unknown as IncomingMessage, res as unknown as ServerResponse, 1024);
    req.emit("data", Buffer.from(JSON.stringify({ ok: true })));
    req.emit("end");
    const result = await promise;
    expect(result).toEqual({ ok: true });
  });

  it("1MB 초과 요청 → 413 + null 반환", async () => {
    const req = make_mock_req();
    const res = make_mock_res();
    const max_bytes = 100; // 100바이트 제한
    const promise = read_json_body(req as unknown as IncomingMessage, res as unknown as ServerResponse, max_bytes);
    req.emit("data", Buffer.alloc(150, "a")); // 150바이트 전송
    const result = await promise;
    expect(result).toBeNull();
    expect(res.statusCode).toBe(413);
    expect(res.body).toContain("payload_too_large");
    expect(req.destroy).toHaveBeenCalled();
  });

  it("정확히 한계 크기 → 파싱 성공", async () => {
    const req = make_mock_req();
    const res = make_mock_res();
    const payload = JSON.stringify({ data: "x" });
    const promise = read_json_body(req as unknown as IncomingMessage, res as unknown as ServerResponse, payload.length);
    req.emit("data", Buffer.from(payload));
    req.emit("end");
    const result = await promise;
    expect(result).toEqual({ data: "x" });
  });

  it("잘못된 JSON → null 반환 (413이 아님)", async () => {
    const req = make_mock_req();
    const res = make_mock_res();
    const promise = read_json_body(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    req.emit("data", Buffer.from("not json"));
    req.emit("end");
    const result = await promise;
    expect(result).toBeNull();
    expect(res.statusCode).toBe(200); // 413으로 변경되지 않음
  });
});

// ── webhook secret 인증 테스트 ──────────────

/** verify_token과 동일한 로직. webhook.ts L22-31 미러. */
function verify_token(req: { headers: Record<string, string> }, secret: string | undefined): boolean {
  if (!secret) return true;
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  const expected = createHash("sha256").update(secret, "utf8").digest();
  const actual = createHash("sha256").update(token, "utf8").digest();
  return expected.length === actual.length && require("node:crypto").timingSafeEqual(expected, actual);
}

describe("SH-1: webhook secret 인증", () => {
  const SECRET = "my-webhook-secret-2024";

  it("secret 미설정 → 항상 통과", () => {
    expect(verify_token({ headers: {} }, undefined)).toBe(true);
  });

  it("올바른 Bearer 토큰 → 인증 성공", () => {
    expect(verify_token({ headers: { authorization: `Bearer ${SECRET}` } }, SECRET)).toBe(true);
  });

  it("잘못된 토큰 → 인증 실패", () => {
    expect(verify_token({ headers: { authorization: "Bearer wrong-token" } }, SECRET)).toBe(false);
  });

  it("Bearer 접두사 없음 → 인증 실패", () => {
    expect(verify_token({ headers: { authorization: SECRET } }, SECRET)).toBe(false);
  });

  it("Authorization 헤더 없음 → 인증 실패", () => {
    expect(verify_token({ headers: {} }, SECRET)).toBe(false);
  });

  it("빈 토큰 → 인증 실패", () => {
    expect(verify_token({ headers: { authorization: "Bearer " } }, SECRET)).toBe(false);
  });
});
