/**
 * http-utils.ts — 미커버 분기 (cov):
 * - L17: response.json() 거부 → .catch(() => ({})) 콜백 실행
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { parse_json_response } from "@src/channels/http-utils.js";

afterEach(() => { vi.unstubAllGlobals(); });

// ── L17: response.json() 거부 → {} fallback ──────────────────────────────────

describe("parse_json_response — L17: json() 거부 → {} 반환", () => {
  it("response.json() 거부 → .catch(() => ({})) 실행 → 빈 객체 반환 (L17)", async () => {
    const mock_response = {
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response;

    const result = await parse_json_response(mock_response);
    expect(result).toEqual({});
  });
});
