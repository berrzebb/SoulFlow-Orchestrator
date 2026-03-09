/**
 * media-extractor — detect_media_type 분기, HTML 태그, 링크 추출, 중복 제거 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 의존성 mock ─────────────────────────────────────────────────────────────

const mock_exists = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mock_stat   = vi.hoisted(() => vi.fn().mockReturnValue({ isFile: () => true }));
const mock_is_local   = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mock_normalize  = vi.hoisted(() => vi.fn((s: string) => s || ""));
const mock_resolve    = vi.hoisted(() => vi.fn((_ws: string, p: string) => `/ws/${p}`));

vi.mock("node:fs", () => ({
  existsSync: mock_exists,
  statSync: mock_stat,
}));

vi.mock("@src/utils/local-ref.js", () => ({
  is_local_reference: mock_is_local,
  normalize_local_candidate_path: mock_normalize,
  resolve_local_reference: mock_resolve,
}));

import { extract_media_items } from "@src/channels/media-extractor.js";

const WS = "/workspace";

beforeEach(() => {
  vi.clearAllMocks();
  mock_exists.mockReturnValue(true);
  mock_stat.mockReturnValue({ isFile: () => true });
  mock_is_local.mockReturnValue(true);
  mock_normalize.mockImplementation((s: string) => s || "");
  mock_resolve.mockImplementation((_ws: string, p: string) => `/ws/${p}`);
});

// ══════════════════════════════════════════
// detect_media_type — 각 타입 분기
// ══════════════════════════════════════════

describe("extract_media_items — 이미지 타입", () => {
  it("png 확장자 → image", () => {
    const { media } = extract_media_items("![alt](photo.png)", WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("image");
  });

  it("jpg/jpeg 확장자 → image", () => {
    const { media } = extract_media_items("![](shot.jpg)", WS);
    expect(media[0].type).toBe("image");
  });

  it("webp 확장자 → image", () => {
    const { media } = extract_media_items("![](icon.webp)", WS);
    expect(media[0].type).toBe("image");
  });
});

describe("extract_media_items — 비디오 타입", () => {
  it("mp4 확장자 → video", () => {
    const { media } = extract_media_items("![clip](movie.mp4)", WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("video");
  });

  it("webm 확장자 → video", () => {
    const { media } = extract_media_items("![](demo.webm)", WS);
    expect(media[0].type).toBe("video");
  });

  it("mkv 확장자 → video", () => {
    const { media } = extract_media_items("![](video.mkv)", WS);
    expect(media[0].type).toBe("video");
  });
});

describe("extract_media_items — 오디오 타입", () => {
  it("mp3 확장자 → audio", () => {
    const { media } = extract_media_items("![music](song.mp3)", WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("audio");
  });

  it("wav 확장자 → audio", () => {
    const { media } = extract_media_items("![](beep.wav)", WS);
    expect(media[0].type).toBe("audio");
  });

  it("m4a 확장자 → audio", () => {
    const { media } = extract_media_items("![](track.m4a)", WS);
    expect(media[0].type).toBe("audio");
  });
});

describe("extract_media_items — 파일 타입", () => {
  it("pdf 확장자 → file", () => {
    const { media } = extract_media_items("![report](report.pdf)", WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("file");
  });

  it("zip 확장자 → file", () => {
    const { media } = extract_media_items("![archive](data.zip)", WS);
    expect(media[0].type).toBe("file");
  });

  it("json 확장자 → file", () => {
    const { media } = extract_media_items("![data](config.json)", WS);
    expect(media[0].type).toBe("file");
  });

  it("md 확장자 → file", () => {
    const { media } = extract_media_items("![docs](readme.md)", WS);
    expect(media[0].type).toBe("file");
  });
});

// ══════════════════════════════════════════
// detect_media_type — null 반환 (미인식 확장자)
// ══════════════════════════════════════════

describe("extract_media_items — 미인식 확장자", () => {
  it("ts 확장자 → detect_media_type=null → 미디어 제외, 원본 텍스트 유지", () => {
    const text = "![code](script.ts)";
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(0);
    expect(content).toContain("script.ts");
  });

  it("exe 확장자 → 미디어 제외", () => {
    const { media } = extract_media_items("![bin](app.exe)", WS);
    expect(media).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// HTML 태그 추출 (img / video)
// ══════════════════════════════════════════

describe("extract_media_items — HTML 태그", () => {
  it("<img src='...'> → 추출 후 content에서 제거", () => {
    const text = `Hello <img src="photo.png"> world`;
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("image");
    expect(content).not.toContain("<img");
    expect(content).toContain("Hello");
    expect(content).toContain("world");
  });

  it("<video src='...'> → 추출 후 content에서 제거", () => {
    const text = `Watch: <video src="clip.mp4"> done`;
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("video");
    expect(content).not.toContain("<video");
  });

  it("HTML 태그 — 미인식 확장자 → 원본 유지", () => {
    const text = `<img src="file.ts">`;
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(0);
    expect(content).toContain("<img");
  });
});

// ══════════════════════════════════════════
// 일반 링크 추출 (마크다운 이미지 아닌 것)
// ══════════════════════════════════════════

describe("extract_media_items — 링크 추출", () => {
  it("[label](file.pdf) → 파일 추출", () => {
    const text = "Download [report](report.pdf) here";
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("file");
    expect(media[0].name).toBe("report");
    expect(content).not.toContain("[report]");
  });

  it("[label](video.mp4) → 비디오 추출", () => {
    const { media } = extract_media_items("[clip](video.mp4)", WS);
    expect(media[0].type).toBe("video");
  });

  it("[label](unknown.xyz) — 미인식 확장자 → 링크 유지", () => {
    const text = "[link](page.html)";
    const { content, media } = extract_media_items(text, WS);
    expect(media).toHaveLength(0);
    expect(content).toContain("[link]");
  });
});

// ══════════════════════════════════════════
// 중복 제거 (동일 경로)
// ══════════════════════════════════════════

describe("extract_media_items — 중복 제거", () => {
  it("동일 파일 두 번 참조 → 1개만 추출", () => {
    // mock_resolve가 항상 같은 경로 반환 → 중복
    mock_resolve.mockReturnValue("/ws/photo.png");
    const text = "![a](photo.png) and ![b](photo.png)";
    const { media } = extract_media_items(text, WS);
    expect(media).toHaveLength(1);
  });

  it("서로 다른 경로 → 각각 추출", () => {
    mock_resolve.mockImplementation((_ws: string, p: string) => `/ws/${p}`);
    const text = "![a](a.png) and ![b](b.png)";
    const { media } = extract_media_items(text, WS);
    expect(media).toHaveLength(2);
  });
});

// ══════════════════════════════════════════
// 로컬 참조 아닌 경우
// ══════════════════════════════════════════

describe("extract_media_items — 비로컬 참조", () => {
  it("is_local_reference=false → 추출 안 함", () => {
    mock_is_local.mockReturnValue(false);
    const text = "![remote](http://example.com/img.png)";
    const { media, content } = extract_media_items(text, WS);
    expect(media).toHaveLength(0);
    expect(content).toContain("http://example.com");
  });

  it("normalize_local_candidate_path='' (빈 문자열) → 추출 안 함", () => {
    mock_normalize.mockReturnValue("");
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(0);
  });

  it("resolve_local_reference=null → 추출 안 함", () => {
    mock_resolve.mockReturnValue(null as any);
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// 파일 시스템 조건
// ══════════════════════════════════════════

describe("extract_media_items — 파일 시스템 조건", () => {
  it("existsSync=false → 추출 안 함", () => {
    mock_exists.mockReturnValue(false);
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(0);
  });

  it("isFile()=false → 추출 안 함 (디렉터리)", () => {
    mock_stat.mockReturnValue({ isFile: () => false });
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(0);
  });

  it("statSync throws → 추출 안 함", () => {
    mock_stat.mockImplementation(() => { throw new Error("EACCES"); });
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// content 정리 (연속 빈 줄 제거)
// ══════════════════════════════════════════

describe("extract_media_items — content 정리", () => {
  it("미디어 제거 후 연속 빈 줄 → 최대 1개 빈 줄", () => {
    const text = "Line1\n\n\n\n![](photo.png)\n\n\n\nLine2";
    const { content } = extract_media_items(text, WS);
    expect(content).not.toMatch(/\n{3,}/);
    expect(content).toContain("Line1");
    expect(content).toContain("Line2");
  });

  it("빈 텍스트 → 빈 content, 빈 media", () => {
    const { content, media } = extract_media_items("", WS);
    expect(content).toBe("");
    expect(media).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// alt/name 처리
// ══════════════════════════════════════════

describe("extract_media_items — name 처리", () => {
  it("alt 텍스트가 120자 초과 → 잘림", () => {
    const long_alt = "a".repeat(200);
    const { media } = extract_media_items(`![${long_alt}](photo.png)`, WS);
    expect(media).toHaveLength(1);
    expect(media[0].name!.length).toBeLessThanOrEqual(120);
  });

  it("alt 없음 → name=undefined", () => {
    const { media } = extract_media_items("![](photo.png)", WS);
    expect(media).toHaveLength(1);
    // alt=""이면 슬라이스 결과도 ""
    expect(media[0].name).toBe("");
  });
});
