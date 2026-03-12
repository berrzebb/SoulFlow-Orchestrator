/**
 * 채널별 스트리밍 렌더링 추상화.
 * ChannelRendererLike 계약만 구현하면 Web / Slack / Telegram 등 어떤 채널도 추가 가능.
 */

import type { InboundMessage } from "../bus/types.js";
import type { StreamEvent } from "./stream-event.js";
import type { RenderProfile } from "./rendering.js";
import type { PersonaMessageIntent } from "./persona-message-renderer.js";
import type { ChannelRegistryLike } from "./types.js";
import type { DispatchService } from "./dispatch.service.js";
import type { Logger } from "../logger.js";
import { ChannelBlockRenderer } from "./channel-block-renderer.js";
import { resolve_reply_to } from "./types.js";
import { now_iso, error_message } from "../utils/common.js";

// ─── 인터페이스 ────────────────────────────────────────────────────────────

/** 채널 렌더러 공통 계약. 각 채널은 이 인터페이스만 구현하면 됨. */
export interface ChannelRendererLike {
  /** 스트리밍 텍스트 청크. on_stream 콜백에서 호출. */
  on_text_chunk(chunk: string): void;
  /** rich StreamEvent 수신. delta는 on_text_chunk 경로 전용이므로 무시해도 됨. */
  on_stream_event(event: StreamEvent): void;
  /** 도구 실행 시작. on_tool_block 콜백에서 호출. */
  on_tool_start(name: string): void;
  /** 정상 완료 후 렌더링 정리. deliver_result() 호출 전에 await. */
  flush(final_content?: string): Promise<void>;
  /** 에러 발생 시 렌더링 정리. 예외를 throw해서는 안 됨. */
  flush_on_error(): Promise<void>;
  /** deliver_result()가 편집 vs 신규 전송을 결정하는 데 사용. */
  readonly stream_message_id: string;
  /** deliver_result()가 상태 메시지 패턴 여부를 판단하는 데 사용. */
  readonly tool_count: number;
}

// ─── Native stream 채널 (Slack / Telegram) ────────────────────────────────

type NativeStreamChannel = {
  start_native_stream(chat_id: string, reply_to: string): Promise<{ ok: boolean; stream_id?: string; error?: string }>;
  append_native_stream(chat_id: string, stream_id: string, text: string): Promise<{ ok: boolean; error?: string }>;
  stop_native_stream?(chat_id: string, stream_id: string): Promise<{ ok: boolean; error?: string }>;
};

function is_native_stream_channel(ch: unknown): ch is NativeStreamChannel {
  return typeof (ch as NativeStreamChannel)?.start_native_stream === "function"
    && typeof (ch as NativeStreamChannel)?.append_native_stream === "function";
}

/** 도구 이름 → 아이콘 / 라벨. */
const STATUS_ICONS: Record<string, string> = {
  Read: "📄", Glob: "📂", Grep: "🔍", Edit: "✏️", Write: "✏️",
  Bash: "🔧", WebFetch: "🌐", WebSearch: "🌐", Agent: "🤖",
};
const STATUS_LABELS: Record<string, string> = {
  Read: "파일 읽는 중", Glob: "파일 검색 중", Grep: "코드 검색 중",
  Edit: "수정 중", Write: "파일 작성 중", Bash: "명령 실행 중",
  WebFetch: "웹 조회 중", WebSearch: "웹 검색 중", Agent: "서브에이전트 실행 중",
};

// ─── Web 채널 구현 ─────────────────────────────────────────────────────────

export type WebChannelRendererDeps = {
  chat_id: string;
  on_web_stream?: ((chat_id: string, content: string, done: boolean) => void) | null;
  on_web_rich_event?: ((chat_id: string, event: StreamEvent) => void) | null;
};

/** Web 채널: NDJSON 스트림 + rich event. */
export class WebChannelRenderer implements ChannelRendererLike {
  private readonly chat_id: string;
  private readonly on_web_stream: ((chat_id: string, content: string, done: boolean) => void) | null;
  private readonly on_web_rich_event: ((chat_id: string, event: StreamEvent) => void) | null;
  private _last_update = 0;
  private _tool_count = 0;
  private _accumulated = "";

  constructor(deps: WebChannelRendererDeps) {
    this.chat_id = deps.chat_id;
    this.on_web_stream = deps.on_web_stream ?? null;
    this.on_web_rich_event = deps.on_web_rich_event ?? null;
  }

  on_text_chunk(chunk: string): void {
    this._accumulated += chunk;
    const now = Date.now();
    if (now - this._last_update < 80) return;
    this._last_update = now;
    this.on_web_stream?.(this.chat_id, this._accumulated, false);
  }

  on_stream_event(event: StreamEvent): void {
    if (event.type === "delta") return;
    this.on_web_rich_event?.(this.chat_id, event);
  }

  on_tool_start(_name: string): void {
    this._tool_count++;
  }

  async flush(final_content?: string): Promise<void> {
    this.on_web_stream?.(this.chat_id, final_content ?? this._accumulated, true);
  }

  async flush_on_error(): Promise<void> {
    this.on_web_stream?.(this.chat_id, this._accumulated, true);
  }

  get stream_message_id() { return ""; }
  get tool_count() { return this._tool_count; }
}

// ─── Native 채널 구현 (Slack / Telegram / Discord) ─────────────────────────

export type NativeChannelRendererDeps = {
  provider: string;
  message: InboundMessage;
  alias: string;
  /** true 시 텍스트 스트림 억제 — 상태 인디케이터 메시지만 사용. */
  is_status_mode: boolean;
  get_render_profile: () => RenderProfile;
  render_msg: (intent: PersonaMessageIntent) => string;
  dispatch: DispatchService;
  registry: ChannelRegistryLike;
  logger: Logger;
};

/** Slack / Telegram / Discord 등 native API 채널. */
export class NativeChannelRenderer implements ChannelRendererLike {
  private readonly deps: NativeChannelRendererDeps;
  private readonly block_renderer = new ChannelBlockRenderer();
  /** send_or_edit_stream / on_tool_start 직렬화 체인. */
  private _chain = Promise.resolve();
  private _message_id = "";
  private _last_update = 0;
  private _native_stream_active = false;
  private _finalize_native_stream: (() => Promise<void>) | null = null;
  private _tool_count = 0;
  private _accumulated = "";

  constructor(deps: NativeChannelRendererDeps) {
    this.deps = deps;
  }

  on_text_chunk(chunk: string): void {
    this._accumulated += chunk;
    if (this.deps.is_status_mode) return;   // status mode: 텍스트 억제
    if (this._tool_count > 0) return;       // 도구 실행 중: 억제 (완료 후 새 메시지 전송)
    this._chain = this._chain
      .then(() => this._send_or_edit_stream(this._accumulated))
      .catch((e) => this.deps.logger.debug("stream_update_failed", { error: error_message(e) }));
  }

  on_stream_event(event: StreamEvent): void {
    if (event.type === "delta") return;
    this.block_renderer.push(event);
  }

  on_tool_start(name: string): void {
    this._tool_count++;
    const icon = STATUS_ICONS[name] || "🔧";
    const label = STATUS_LABELS[name] || `${name} 실행 중`;
    const progress_text = this.deps.render_msg({
      kind: "status_progress",
      label: `${icon} ${label}`,
      tool_count: this._tool_count,
    });
    this._chain = this._chain
      .then(() => this._message_id
        ? this._update_status_message(progress_text)
        : this._send_status_message(progress_text),
      )
      .catch((e) => this.deps.logger.debug("status_update_failed", { error: error_message(e) }));
  }

  async flush(_final_content?: string): Promise<void> {
    await this._chain;
    if (this._finalize_native_stream) {
      await this._finalize_native_stream().catch((e) =>
        this.deps.logger.debug("native_stream_stop_failed", { error: error_message(e) }),
      );
    }
    if (this.block_renderer.has_content()) {
      await this._send_block_summary().catch((e) =>
        this.deps.logger.debug("block_summary_failed", { error: error_message(e) }),
      );
    }
  }

  async flush_on_error(): Promise<void> {
    await this._chain.catch(() => {});
    if (this._finalize_native_stream) {
      await this._finalize_native_stream().catch(() => {});
    }
    if (this.block_renderer.has_content()) {
      await this._send_block_summary().catch(() => {});
    }
  }

  get stream_message_id() { return this._message_id; }
  get tool_count() { return this._tool_count; }

  private async _send_or_edit_stream(content: string): Promise<void> {
    const { provider, message, alias, dispatch, registry, logger } = this.deps;
    const now = Date.now();
    if (now - this._last_update < 1200) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    // Native streaming (Slack chat.startStream / Telegram sendMessageDraft)
    if (this._native_stream_active || !this._message_id) {
      const [native_ch] = registry.get_channels_by_provider(provider);
      if (is_native_stream_channel(native_ch)) {
        if (!this._native_stream_active) {
          const reply_to = resolve_reply_to(provider, message);
          const start = await native_ch.start_native_stream(message.chat_id, reply_to);
          if (start.ok && start.stream_id) {
            this._message_id = start.stream_id;
            this._native_stream_active = true;
            if (native_ch.stop_native_stream) {
              const ch = native_ch, chat_id = message.chat_id, sid = start.stream_id;
              this._finalize_native_stream = async () => { await ch.stop_native_stream!(chat_id, sid); };
            }
          }
        }
        if (this._native_stream_active) {
          const res = await native_ch.append_native_stream(message.chat_id, this._message_id, trimmed);
          if (res.ok) {
            this._last_update = now;
          } else {
            logger.debug("native_stream_append_failed", { error: res.error });
          }
          return;
        }
        // start 실패 → edit 방식으로 폴백
      }
    }

    // Edit-based streaming (폴백)
    const char_limit = provider === "telegram" ? 4000 : 3800;
    const display = trimmed.length > char_limit
      ? "…\n" + trimmed.slice(trimmed.length - char_limit + 2)
      : trimmed;
    const text = this._tool_count > 0 ? `[${this._tool_count} tool calls]\n${display}` : display;

    if (this._message_id) {
      try {
        await registry.edit_message(provider, message.chat_id, this._message_id, text);
      } catch (e) {
        logger.debug("stream_edit_failed", { error: error_message(e) });
      }
    } else {
      const profile = this.deps.get_render_profile();
      const result = await dispatch.send(provider, {
        id: `stream-${Date.now()}`, provider, channel: provider, sender_id: alias,
        chat_id: message.chat_id, content: text, at: now_iso(),
        reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id,
        metadata: { kind: "agent_stream", agent_alias: alias, render_mode: profile.mode, render_parse_mode: null },
      });
      if (result.ok && result.message_id) this._message_id = result.message_id;
    }
    this._last_update = now;
  }

  private async _send_status_message(status_text: string): Promise<void> {
    const { provider, message, alias, dispatch } = this.deps;
    const result = await dispatch.send(provider, {
      id: `status-${Date.now()}`, provider, channel: provider, sender_id: alias,
      chat_id: message.chat_id, content: status_text, at: now_iso(),
      reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id,
      metadata: { kind: "agent_status", agent_alias: alias },
    });
    if (result.ok && result.message_id) {
      this._message_id = result.message_id;
      this._last_update = Date.now();
    }
  }

  private async _update_status_message(status_text: string): Promise<void> {
    if (!this._message_id) return;
    const now = Date.now();
    if (now - this._last_update < 1500) return;
    const { provider, message, registry, logger } = this.deps;
    try {
      await registry.edit_message(provider, message.chat_id, this._message_id, status_text);
      this._last_update = now;
    } catch (e) {
      logger.debug("status_edit_failed", { error: error_message(e) });
    }
  }

  private async _send_block_summary(): Promise<void> {
    if (!this.block_renderer.has_content()) return;
    const { provider, message, alias, dispatch } = this.deps;
    const profile = this.deps.get_render_profile();
    const text = this.block_renderer.render(profile.mode);
    if (!text) return;
    const render_parse_mode = profile.mode === "html" ? "HTML" : null;
    await dispatch.send(provider, {
      id: `blocks-${Date.now()}`, provider, channel: provider, sender_id: alias,
      chat_id: message.chat_id, content: text, at: now_iso(),
      reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id,
      metadata: { kind: "agent_blocks", agent_alias: alias, render_parse_mode },
    });
  }
}

// ─── 팩토리 ────────────────────────────────────────────────────────────────

export type ChannelRendererFactoryDeps =
  NativeChannelRendererDeps & WebChannelRendererDeps;

/** provider에 따라 적절한 ChannelRendererLike 구현체를 반환. */
export function create_channel_renderer(
  provider: string,
  deps: ChannelRendererFactoryDeps,
): ChannelRendererLike {
  if (provider === "web") {
    return new WebChannelRenderer({
      chat_id: deps.chat_id,
      on_web_stream: deps.on_web_stream,
      on_web_rich_event: deps.on_web_rich_event,
    });
  }
  return new NativeChannelRenderer({
    provider,
    message: deps.message,
    alias: deps.alias,
    is_status_mode: deps.is_status_mode,
    get_render_profile: deps.get_render_profile,
    render_msg: deps.render_msg,
    dispatch: deps.dispatch,
    registry: deps.registry,
    logger: deps.logger,
  });
}
