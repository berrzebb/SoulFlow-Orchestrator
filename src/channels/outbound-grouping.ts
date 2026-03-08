/** 아웃바운드 메시지 그룹핑 버퍼.
 *
 * 같은 (provider, chat_id) 쌍으로 짧은 시간 내 오는 여러 메시지를
 * windowMs 동안 수집한 뒤 하나로 합쳐서 플러시한다.
 * maxMessages 도달 시 즉시 플러시.
 */

import type { OutboundMessage } from "../bus/types.js";

export type GroupingConfig = {
  enabled: boolean;
  windowMs: number;
  maxMessages: number;
};

type GroupKey = string;

type GroupEntry = {
  messages: OutboundMessage[];
  timer: ReturnType<typeof setTimeout>;
};

type FlushCallback = (messages: OutboundMessage[]) => void;

export class OutboundGroupingBuffer {
  private readonly groups = new Map<GroupKey, GroupEntry>();
  private readonly config: GroupingConfig;
  private readonly on_flush: FlushCallback;

  constructor(config: GroupingConfig, on_flush: FlushCallback) {
    this.config = config;
    this.on_flush = on_flush;
  }

  /** 메시지를 버퍼에 추가. 그룹핑 비활성화 시 즉시 플러시. */
  push(provider: string, message: OutboundMessage): void {
    if (!this.config.enabled) {
      this.on_flush([message]);
      return;
    }

    const key = this.make_key(provider, message);
    const existing = this.groups.get(key);

    if (existing) {
      existing.messages.push(message);
      if (existing.messages.length >= this.config.maxMessages) {
        clearTimeout(existing.timer);
        this.flush(key);
      }
    } else {
      const timer = setTimeout(() => this.flush(key), this.config.windowMs);
      this.groups.set(key, { messages: [message], timer });
    }
  }

  /** 모든 대기 그룹을 즉시 플러시. 종료 시 호출. */
  flush_all(): void {
    for (const key of [...this.groups.keys()]) {
      this.flush(key);
    }
  }

  private flush(key: GroupKey): void {
    const entry = this.groups.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.groups.delete(key);

    if (entry.messages.length === 0) return;
    if (entry.messages.length === 1) {
      this.on_flush(entry.messages);
      return;
    }

    // 여러 메시지를 하나로 병합: content 결합, 첫 메시지의 메타 유지
    const merged = merge_messages(entry.messages);
    this.on_flush([merged]);
  }

  private make_key(provider: string, message: OutboundMessage): string {
    return `${provider}:${message.chat_id}:${message.thread_id || ""}`;
  }
}

function merge_messages(messages: OutboundMessage[]): OutboundMessage {
  const base = messages[0]!;
  const combined_content = messages
    .map((m) => m.content)
    .filter(Boolean)
    .join("\n\n");
  // 미디어: 모든 메시지의 미디어를 합침
  const all_media = messages.flatMap((m) => m.media || []);
  return {
    ...base,
    content: combined_content,
    media: all_media.length > 0 ? all_media : undefined,
  };
}
