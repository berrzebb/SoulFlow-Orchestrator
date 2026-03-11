/** InboundDebouncer — 동일 채팅의 빠른 연속 메시지를 시간 창 내 배치로 묶어 처리. */

export type InboundDebouncerOptions = {
  /** 첫 메시지 도착 후 플러시까지 대기 시간 (ms). */
  window_ms: number;
  /** 이 수에 도달하면 windowMs 경과 전이라도 즉시 플러시. */
  max_messages: number;
};

/** InboundMessage의 최소 공통 구조. */
export type DebouncableMessage = {
  chat_id: string;
  content?: unknown;
};

/**
 * 같은 chat_key 메시지를 window_ms 내에 배치로 묶어 on_flush 호출.
 * - 첫 메시지 도착 시 타이머 설정. 이후 메시지는 버퍼에 추가.
 * - max_messages 초과 → 타이머 전 즉시 플러시.
 * - 타이머 만료 → 누적 버퍼 플러시.
 */
export class InboundDebouncer<T extends DebouncableMessage> {
  private readonly buffers = new Map<string, T[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly window_ms: number;
  private readonly max_messages: number;
  private flush_handler: ((chat_key: string, items: T[]) => void) | null = null;

  constructor(opts: InboundDebouncerOptions) {
    this.window_ms = opts.window_ms;
    this.max_messages = opts.max_messages;
  }

  /** 플러시 콜백 등록. */
  set_handler(fn: (chat_key: string, items: T[]) => void): void {
    this.flush_handler = fn;
  }

  push(chat_key: string, item: T): void {
    const buf = this.buffers.get(chat_key) ?? [];
    buf.push(item);
    this.buffers.set(chat_key, buf);

    if (buf.length >= this.max_messages) {
      this.flush(chat_key);
      return;
    }

    // 첫 메시지에만 타이머 설정 (이후 메시지는 기존 타이머 유지)
    if (!this.timers.has(chat_key)) {
      const t = setTimeout(() => this.flush(chat_key), this.window_ms);
      this.timers.set(chat_key, t);
    }
  }

  /** 배치된 메시지를 content 이어붙임으로 단일 메시지로 병합. */
  static merge<T extends DebouncableMessage>(items: T[]): T & { content: string } {
    const combined = items
      .map((m) => String(m.content ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
    return { ...items[0], content: combined };
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.buffers.clear();
  }

  get pending_chat_count(): number {
    return this.buffers.size;
  }

  private flush(chat_key: string): void {
    const t = this.timers.get(chat_key);
    if (t) { clearTimeout(t); this.timers.delete(chat_key); }
    const items = this.buffers.get(chat_key) ?? [];
    this.buffers.delete(chat_key);
    if (items.length > 0) this.flush_handler?.(chat_key, items);
  }
}
