import { describe, it, expect, vi } from "vitest";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

describe("StreamBuffer", () => {
  it("append accumulates content", () => {
    const buf = new StreamBuffer();
    buf.append("hello");
    buf.append("world");
    // deduplicate trims incoming chunks, so trailing space is removed
    expect(buf.get_full_content()).toBe("helloworld");
  });

  it("should_flush returns false when buffer is empty", () => {
    const buf = new StreamBuffer();
    expect(buf.should_flush(0, 0)).toBe(false);
  });

  it("should_flush respects min_chars", () => {
    const buf = new StreamBuffer();
    buf.append("hi");
    expect(buf.should_flush(0, 100)).toBe(false);
    expect(buf.should_flush(0, 1)).toBe(true);
  });

  it("should_flush respects interval_ms", () => {
    const buf = new StreamBuffer();
    buf.append("hello world content here");
    // last_flush_at starts at 0, so elapsed = Date.now() which is >> any interval
    expect(buf.should_flush(100, 1)).toBe(true);
  });

  it("should_flush returns false within interval after flush", () => {
    const buf = new StreamBuffer();
    buf.append("hello world content here");
    buf.flush();
    buf.append("next content");
    // Just flushed, so elapsed is near 0
    expect(buf.should_flush(60_000, 1)).toBe(false);
  });

  it("flush returns content and resets buffer", () => {
    const buf = new StreamBuffer();
    buf.append("hello");
    const flushed = buf.flush();
    expect(flushed).toBe("hello");
    // Buffer is now empty
    expect(buf.flush()).toBeNull();
  });

  it("flush returns null for whitespace-only buffer", () => {
    const buf = new StreamBuffer();
    buf.append("   ");
    expect(buf.flush()).toBeNull();
  });

  it("flush deduplicates identical consecutive flushes", () => {
    const buf = new StreamBuffer();
    buf.append("same content");
    expect(buf.flush()).toBe("same content");
    buf.append("same content");
    expect(buf.flush()).toBeNull();
  });

  it("has_streamed returns false before first flush, true after", () => {
    const buf = new StreamBuffer();
    expect(buf.has_streamed()).toBe(false);
    buf.append("data");
    buf.flush();
    expect(buf.has_streamed()).toBe(true);
  });

  it("get_flush_count tracks successful flushes", () => {
    const buf = new StreamBuffer();
    expect(buf.get_flush_count()).toBe(0);
    buf.append("a");
    buf.flush();
    expect(buf.get_flush_count()).toBe(1);
    buf.append("b");
    buf.flush();
    expect(buf.get_flush_count()).toBe(2);
  });

  it("get_full_content returns everything appended regardless of flushes", () => {
    const buf = new StreamBuffer();
    buf.append("first");
    buf.flush();
    buf.append("second");
    // deduplicate trims, so no space between chunks
    expect(buf.get_full_content()).toBe("firstsecond");
  });

  it("deduplicates overlapping chunks", () => {
    const buf = new StreamBuffer();
    buf.append("hello world");
    buf.append("hello world and more");
    // "hello world and more" starts with "hello world", delta = " and more" (공백 보존)
    expect(buf.get_full_content()).toBe("hello world and more");
  });

  it("deduplicates exact duplicate chunks", () => {
    const buf = new StreamBuffer();
    buf.append("same");
    buf.append("same");
    expect(buf.get_full_content()).toBe("same");
  });

  it("detects suffix-prefix overlap", () => {
    const buf = new StreamBuffer();
    buf.append("Hello, how are");
    buf.append("are you doing?");
    // overlap "are" detected, delta = " you doing?" (단어 경계 공백 보존)
    expect(buf.get_full_content()).toBe("Hello, how are you doing?");
  });

  it("handles empty/null chunks gracefully", () => {
    const buf = new StreamBuffer();
    buf.append("");
    buf.append("  ");
    buf.append("real content");
    // 공백 전용 청크("  ")도 유효한 콘텐츠로 축적
    expect(buf.get_full_content()).toBe("  real content");
  });

  it("multiple flush cycles work correctly", () => {
    const buf = new StreamBuffer();
    buf.append("cycle1");
    expect(buf.flush()).toBe("cycle1");

    buf.append("cycle2");
    expect(buf.flush()).toBe("cycle2");

    buf.append("cycle3");
    expect(buf.flush()).toBe("cycle3");

    expect(buf.get_flush_count()).toBe(3);
    expect(buf.get_full_content()).toBe("cycle1cycle2cycle3");
  });
});

describe("StreamBuffer — edge cases", () => {
  it("full content caps at MAX_FULL_CHARS (200_000)", () => {
    const buf = new StreamBuffer();
    // 250K chars 주입 → full은 200K로 잘림
    const chunk = "x".repeat(250_000);
    buf.append(chunk);
    expect(buf.get_full_content().length).toBe(200_000);
    // buffer는 전체 포함
    const flushed = buf.flush();
    expect(flushed).toBeTruthy();
    expect(flushed!.length).toBe(250_000);
  });

  it("full content은 후미 200K를 유지한다", () => {
    const buf = new StreamBuffer();
    buf.append("A".repeat(150_000));
    buf.append("B".repeat(100_000));
    const full = buf.get_full_content();
    expect(full.length).toBe(200_000);
    // 후미가 B로 끝나야 함
    expect(full.endsWith("B".repeat(100_000))).toBe(true);
  });

  it("flush dedup은 whitespace만 다른 콘텐츠를 동일로 취급한다", () => {
    const buf = new StreamBuffer();
    buf.append("hello  world");
    expect(buf.flush()).toBe("hello  world");
    // 같은 내용이지만 공백이 다름
    buf.append("hello world");
    expect(buf.flush()).toBeNull(); // dedup key: "hello world" vs "hello world" → 동일
  });

  it("flush dedup은 case만 다른 콘텐츠를 동일로 취급한다", () => {
    const buf = new StreamBuffer();
    buf.append("Hello World");
    expect(buf.flush()).toBe("Hello World");
    buf.append("hello world");
    expect(buf.flush()).toBeNull(); // lowercase key 동일
  });

  it("prev가 incoming보다 길면 incoming은 무시한다 (부분집합)", () => {
    const buf = new StreamBuffer();
    buf.append("complete sentence with more details");
    buf.append("complete sentence");
    // incoming이 prev의 부분집합 → 무시
    expect(buf.get_full_content()).toBe("complete sentence with more details");
  });

  it("overlap_suffix_prefix가 max_scan=280 이내에서 동작한다", () => {
    const buf = new StreamBuffer();
    const overlap = "X".repeat(280);
    buf.append("prefix" + overlap);
    buf.append(overlap + "suffix");
    // 280자 오버랩 감지 → "suffix"만 추가
    expect(buf.get_full_content()).toContain("prefix");
    expect(buf.get_full_content()).toContain("suffix");
    // 오버랩 부분이 중복되지 않아야 함
    const content = buf.get_full_content();
    const firstX = content.indexOf("X");
    const lastX = content.lastIndexOf("X");
    expect(lastX - firstX + 1).toBe(280); // 정확히 280개의 X
  });

  it("연속 빈 flush가 flush_count를 증가시키지 않는다", () => {
    const buf = new StreamBuffer();
    buf.flush();
    buf.flush();
    buf.flush();
    expect(buf.get_flush_count()).toBe(0);
    expect(buf.has_streamed()).toBe(false);
  });

  it("한글 콘텐츠를 정상 처리한다", () => {
    const buf = new StreamBuffer();
    buf.append("안녕하세요. 반갑습니다.");
    buf.append("오늘 날씨가 좋네요.");
    const flushed = buf.flush();
    expect(flushed).toBeTruthy();
    expect(flushed).toContain("안녕하세요");
    expect(flushed).toContain("좋네요");
  });

  it("도구 이벤트 + 텍스트가 올바르게 누적된다", () => {
    const buf = new StreamBuffer();
    buf.append("분석을 시작합니다.");
    buf.append("\n▸ `read_file`");
    buf.append(" → 파일 내용: ...");
    buf.append("\n결과를 정리하겠습니다.");
    const full = buf.get_full_content();
    expect(full).toContain("분석을 시작합니다.");
    expect(full).toContain("▸ `read_file`");
    expect(full).toContain("→ 파일 내용");
    expect(full).toContain("결과를 정리하겠습니다.");
  });
});

// L51: get_last_flushed
describe("StreamBuffer — get_last_flushed (L51)", () => {
  it("flush 후 get_last_flushed → normalized key 반환 (L51)", () => {
    const buf = new StreamBuffer();
    buf.append("Hello World");
    buf.flush();
    // flush는 content.replace(/\s+/g, " ").toLowerCase()를 key로 저장
    expect(buf.get_last_flushed()).toBe("hello world");
  });
});

// L72: overlap_suffix_prefix 빈 문자열 early return
describe("StreamBuffer — overlap_suffix_prefix 빈 인자 (L72)", () => {
  it("a가 빈 문자열 → 0 반환 (L72)", () => {
    const buf = new StreamBuffer();
    expect((buf as any).overlap_suffix_prefix("", "hello")).toBe(0);
  });

  it("b가 빈 문자열 → 0 반환 (L72)", () => {
    const buf = new StreamBuffer();
    expect((buf as any).overlap_suffix_prefix("hello", "")).toBe(0);
  });
});
