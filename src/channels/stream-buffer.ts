/** 스트리밍 출력의 버퍼링 + 주기적 플러시 + 중복 감지를 담당. */

const MAX_FULL_CHARS = 200_000;

export class StreamBuffer {
  private buffer = "";
  private last_flush_at = 0;
  private flush_count = 0;
  private full = "";
  private last_source = "";
  private last_flushed_key = "";

  /** 새 청크를 버퍼에 추가. 중복·오버랩을 자동 감지하여 delta만 축적. */
  append(raw_chunk: string): void {
    const delta = this.deduplicate(raw_chunk);
    if (!delta) return;
    this.buffer += delta;
    this.full += delta;
    if (this.full.length > MAX_FULL_CHARS) {
      this.full = this.full.slice(this.full.length - MAX_FULL_CHARS);
    }
  }

  /** 플러시 조건 충족 여부 판단. */
  should_flush(interval_ms: number, min_chars: number): boolean {
    if (!this.buffer.trim()) return false;
    if (this.buffer.length < min_chars) return false;
    const elapsed = Date.now() - this.last_flush_at;
    return elapsed >= interval_ms;
  }

  /** 버퍼를 비우고 내용을 반환. 중복 전송 방지 포함. */
  flush(): string | null {
    const content = this.buffer.trim();
    this.buffer = "";
    this.last_flush_at = Date.now();
    if (!content) return null;

    // 중복 전송 방지
    const key = content.replace(/\s+/g, " ").toLowerCase();
    if (key === this.last_flushed_key) return null;
    this.last_flushed_key = key;

    this.flush_count += 1;
    return content;
  }

  has_streamed(): boolean { return this.flush_count > 0; }
  get_flush_count(): number { return this.flush_count; }
  get_full_content(): string { return this.full; }
  get_last_flushed(): string { return this.last_flushed_key; }

  /** 이전 청크와 비교하여 새로운 delta만 추출 (오버랩 감지). */
  private deduplicate(raw: string): string {
    const incoming = String(raw || "").trim();
    if (!incoming) return "";

    const prev = this.last_source;
    this.last_source = incoming.slice(-4000);

    if (!prev) return incoming;
    if (incoming === prev) return "";
    if (incoming.startsWith(prev)) return incoming.slice(prev.length).trimStart();
    if (prev.startsWith(incoming)) return "";

    const overlap = this.overlap_suffix_prefix(prev, incoming);
    if (overlap > 0) return incoming.slice(overlap).trimStart();
    return incoming;
  }

  private overlap_suffix_prefix(a: string, b: string, max_scan = 280): number {
    if (!a || !b) return 0;
    const limit = Math.min(max_scan, a.length, b.length);
    for (let n = limit; n >= 1; n -= 1) {
      if (a.slice(a.length - n) === b.slice(0, n)) return n;
    }
    return 0;
  }
}
