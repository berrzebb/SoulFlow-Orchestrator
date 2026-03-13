/**
 * MapTool — 지도 링크 생성 테스트.
 * 순수 URL 빌더로 네트워크 불필요.
 */
import { describe, it, expect } from "vitest";
import { MapTool } from "@src/agent/tools/map.js";

const tool = new MapTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("MapTool — 메타데이터", () => {
  it("name = map", () => expect(tool.name).toBe("map"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
  it("parameters.required = [location]", () => {
    expect(tool.to_schema().function.parameters.required).toContain("location");
  });
});

// ══════════════════════════════════════════
// Google Maps (기본 provider)
// ══════════════════════════════════════════

describe("MapTool — Google Maps (기본)", () => {
  it("provider 미지정 → google URL 생성", async () => {
    const r = await exec({ location: "Eiffel Tower" });
    expect(r).toContain("maps.google.com");
    // encodeURIComponent: 공백 → %20
    expect(r).toContain("Eiffel%20Tower");
  });

  it("provider=google 명시", async () => {
    const r = await exec({ location: "New York", provider: "google" });
    expect(r).toContain("maps.google.com/?q=New%20York");
    expect(r).toContain("Google Maps");
  });

  it("label 지정 시 링크 텍스트에 반영", async () => {
    const r = await exec({ location: "Paris, France", provider: "google", label: "파리" });
    expect(r.startsWith("[파리]")).toBe(true);
    expect(r).toContain("maps.google.com");
  });

  it("label 미지정 → location 이름이 링크 텍스트", async () => {
    const r = await exec({ location: "London", provider: "google" });
    expect(r.startsWith("[London]")).toBe(true);
  });
});

// ══════════════════════════════════════════
// Kakao Maps
// ══════════════════════════════════════════

describe("MapTool — 카카오맵", () => {
  it("provider=kakao → map.kakao.com URL", async () => {
    const r = await exec({ location: "강남역", provider: "kakao" });
    expect(r).toContain("map.kakao.com/?q=");
    expect(r).toContain("카카오맵");
  });

  it("한국어 장소명 — URL 부분만 인코딩됨", async () => {
    const r = await exec({ location: "서울 강남구 역삼동", provider: "kakao" });
    expect(r).toContain("map.kakao.com/?q=");
    // 마크다운 링크 URL 부분(%xx 인코딩)에 원본 한글이 없어야 함
    const url_part = r.match(/\(([^)]+)\)/)?.[1] ?? "";
    expect(url_part).not.toContain("서울 강남구");
  });

  it("카카오맵 레이블 포함", async () => {
    const r = await exec({ location: "경복궁", provider: "kakao", label: "경복궁 지도" });
    expect(r).toContain("카카오맵");
    expect(r.startsWith("[경복궁 지도]")).toBe(true);
  });
});

// ══════════════════════════════════════════
// Naver Maps
// ══════════════════════════════════════════

describe("MapTool — 네이버 지도", () => {
  it("provider=naver → map.naver.com URL", async () => {
    const r = await exec({ location: "판교역", provider: "naver" });
    expect(r).toContain("map.naver.com/v5/search/");
    expect(r).toContain("네이버 지도");
  });

  it("네이버 URL 경로 형식 — /v5/search/{query}", async () => {
    const r = await exec({ location: "홍대입구역", provider: "naver" });
    // 네이버는 경로에 검색어가 포함됨 (query param이 아님)
    expect(r).toMatch(/map\.naver\.com\/v5\/search\/.+/);
  });
});

// ══════════════════════════════════════════
// 인코딩 / 특수문자
// ══════════════════════════════════════════

describe("MapTool — URL 인코딩", () => {
  it("URL 부분에서 공백 → %20 인코딩", async () => {
    const r = await exec({ location: "서울 시청", provider: "google" });
    // URL 부분(%xx)에 공백이 없어야 함 — label 부분은 원본 유지
    const url_part = r.match(/\((https?:\/\/[^)]+)\)/)?.[1] ?? "";
    expect(url_part).toContain("%20");
    expect(url_part).not.toContain(" ");
  });

  it("특수문자 포함 주소 안전 처리", async () => {
    const r = await exec({ location: "101 Main St, Suite #5", provider: "google" });
    expect(r).toContain("maps.google.com/?q=");
    // 에러 없이 반환되어야 함
    expect(r).not.toContain("Error");
  });

  it("빈 location → Error 반환", async () => {
    const r = await exec({ location: "" });
    expect(r).toContain("Error");
  });

  it("location 미전달 → Error 반환", async () => {
    const r = await exec({});
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 출력 형식 — 마크다운 링크
// ══════════════════════════════════════════

describe("MapTool — 출력 형식", () => {
  it("마크다운 링크 형식: [label](url) (Provider)", async () => {
    const r = await exec({ location: "강남역", provider: "kakao" });
    // geocoding 성공 시 멀티라인 — 첫 번째 줄만 형식 검증
    const first_line = r.split("\n")[0];
    expect(first_line).toMatch(/^\[.+\]\(https?:\/\/.+\) \(.+\)$/);
  });

  it("Google Maps 표기는 'Google Maps'", async () => {
    const r = await exec({ location: "Seoul", provider: "google" });
    expect(r).toContain("(Google Maps)");
  });

  it("카카오맵 표기는 '카카오맵'", async () => {
    const r = await exec({ location: "부산", provider: "kakao" });
    expect(r).toContain("(카카오맵)");
  });

  it("네이버 지도 표기는 '네이버 지도'", async () => {
    const r = await exec({ location: "인천공항", provider: "naver" });
    expect(r).toContain("(네이버 지도)");
  });
});
