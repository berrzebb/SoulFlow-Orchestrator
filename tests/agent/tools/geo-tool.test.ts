/**
 * GeoTool — 거리/방위/중심점/bbox/geohash/DMS 변환 테스트.
 * 순수 계산 로직으로 네트워크 불필요.
 */
import { describe, it, expect } from "vitest";
import { GeoTool } from "@src/agent/tools/geo.js";

const tool = new GeoTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await tool.execute(params);
  try { return JSON.parse(String(r)); } catch { return { raw: r }; }
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("GeoTool — 메타데이터", () => {
  it("name = geo", () => expect(tool.name).toBe("geo"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// distance
// ══════════════════════════════════════════

describe("GeoTool — distance (Haversine)", () => {
  it("서울 → 도쿄 약 1160km", async () => {
    // 서울 37.5665°N, 126.9780°E / 도쿄 35.6762°N, 139.6503°E
    const r = await exec({ action: "distance", lat1: 37.5665, lon1: 126.978, lat2: 35.6762, lon2: 139.6503 });
    expect(r.km).toBeGreaterThan(1000);
    expect(r.km).toBeLessThan(1300);
    expect(typeof r.miles).toBe("number");
    expect(typeof r.meters).toBe("number");
  });

  it("같은 좌표 → 거리 0", async () => {
    const r = await exec({ action: "distance", lat1: 0, lon1: 0, lat2: 0, lon2: 0 });
    expect(r.km).toBe(0);
  });

  it("기본값 (좌표 없음) → 0", async () => {
    const r = await exec({ action: "distance" });
    expect(r.km).toBe(0);
  });
});

// ══════════════════════════════════════════
// bearing
// ══════════════════════════════════════════

describe("GeoTool — bearing", () => {
  it("정북 방향 계산", async () => {
    // 0°N 0°E → 10°N 0°E = 정북(0°)
    const r = await exec({ action: "bearing", lat1: 0, lon1: 0, lat2: 10, lon2: 0 });
    expect(r.bearing).toBeCloseTo(0, 0);
    expect(r.compass).toBe("N");
  });

  it("동쪽 방향 → compass E 근처", async () => {
    const r = await exec({ action: "bearing", lat1: 0, lon1: 0, lat2: 0, lon2: 10 });
    expect(r.bearing).toBeGreaterThan(80);
    expect(r.bearing).toBeLessThan(100);
  });

  it("서울 → 도쿄 방향 (대략 동북쪽)", async () => {
    const r = await exec({ action: "bearing", lat1: 37.5665, lon1: 126.978, lat2: 35.6762, lon2: 139.6503 });
    expect(r.bearing).toBeGreaterThan(80);
    expect(r.bearing).toBeLessThan(150);
  });
});

// ══════════════════════════════════════════
// midpoint
// ══════════════════════════════════════════

describe("GeoTool — midpoint", () => {
  it("두 점의 중심 계산", async () => {
    // (0°, 0°) + (10°, 10°) ≈ (5°, 5°)
    const r = await exec({ action: "midpoint", lat1: 0, lon1: 0, lat2: 10, lon2: 10 });
    expect(r.lat).toBeCloseTo(5, 0);
    expect(r.lon).toBeCloseTo(5, 0);
  });

  it("같은 점 → 자신 반환", async () => {
    const r = await exec({ action: "midpoint", lat1: 37.5, lon1: 127.0, lat2: 37.5, lon2: 127.0 });
    expect(r.lat).toBeCloseTo(37.5, 3);
  });
});

// ══════════════════════════════════════════
// bbox
// ══════════════════════════════════════════

describe("GeoTool — bbox", () => {
  it("바운딩 박스 계산 (반경 10km)", async () => {
    const r = await exec({ action: "bbox", lat1: 37.5, lon1: 127.0, radius_km: 10 });
    expect(r.min_lat).toBeLessThan(37.5);
    expect(r.max_lat).toBeGreaterThan(37.5);
    expect(r.min_lon).toBeLessThan(127.0);
    expect(r.max_lon).toBeGreaterThan(127.0);
  });

  it("기본 반경 1km", async () => {
    const r = await exec({ action: "bbox", lat1: 0, lon1: 0 });
    // ~0.009° ≈ 1km
    expect(r.max_lat - r.min_lat).toBeCloseTo(0.018, 2);
  });
});

// ══════════════════════════════════════════
// geohash_encode / geohash_decode
// ══════════════════════════════════════════

describe("GeoTool — geohash", () => {
  it("서울 geohash 인코딩 (precision=9)", async () => {
    const r = await exec({ action: "geohash_encode", lat1: 37.5665, lon1: 126.978, precision: 9 });
    expect(typeof r.geohash).toBe("string");
    expect((r.geohash as string).length).toBe(9);
  });

  it("geohash 디코딩 → 원래 좌표 근사", async () => {
    // wydjx 는 서울 근처의 geohash
    const r_enc = await exec({ action: "geohash_encode", lat1: 37.5665, lon1: 126.978, precision: 7 });
    const r_dec = await exec({ action: "geohash_decode", geohash: r_enc.geohash });
    expect(r_dec.lat).toBeCloseTo(37.5665, 1);
    expect(r_dec.lon).toBeCloseTo(126.978, 1);
    expect(typeof r_dec.lat_err).toBe("number");
  });

  it("geohash 없음 → Error", async () => {
    const r = await exec({ action: "geohash_decode", geohash: "" });
    expect(String(r.raw)).toContain("Error");
  });

  it("precision 경계: 1 ~ 12", async () => {
    const r1 = await exec({ action: "geohash_encode", lat1: 0, lon1: 0, precision: 1 });
    expect((r1.geohash as string).length).toBe(1);
    const r12 = await exec({ action: "geohash_encode", lat1: 0, lon1: 0, precision: 12 });
    expect((r12.geohash as string).length).toBe(12);
  });
});

// ══════════════════════════════════════════
// dms_to_decimal
// ══════════════════════════════════════════

describe("GeoTool — dms_to_decimal", () => {
  it("37°33'36\"N → 37.56도", async () => {
    const r = await exec({ action: "dms_to_decimal", dms: "37°33'36\"N" });
    expect(r.decimal).toBeCloseTo(37.56, 1);
  });

  it("남위 (S) → 음수", async () => {
    const r = await exec({ action: "dms_to_decimal", dms: "33°52'4\"S" });
    expect(r.decimal).toBeLessThan(0);
  });

  it("서경 (W) → 음수", async () => {
    const r = await exec({ action: "dms_to_decimal", dms: "74°0'23\"W" });
    expect(r.decimal).toBeLessThan(0);
  });

  it("잘못된 형식 → Error", async () => {
    const r = await exec({ action: "dms_to_decimal", dms: "invalid" });
    expect(String(r.raw)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("GeoTool — unknown action", () => {
  it("지원하지 않는 action → Error", async () => {
    const r = await exec({ action: "bogus" });
    expect(String(r.raw)).toContain("Error");
  });
});
