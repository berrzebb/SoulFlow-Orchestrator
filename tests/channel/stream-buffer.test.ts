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
    // "hello world and more" starts with "hello world", so delta = "and more" (trimStart)
    expect(buf.get_full_content()).toBe("hello worldand more");
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
    // overlap "are" detected, delta = "you doing?" (trimStart removes leading space)
    expect(buf.get_full_content()).toBe("Hello, how areyou doing?");
  });

  it("handles empty/null chunks gracefully", () => {
    const buf = new StreamBuffer();
    buf.append("");
    buf.append("  ");
    buf.append("real content");
    expect(buf.get_full_content()).toBe("real content");
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
