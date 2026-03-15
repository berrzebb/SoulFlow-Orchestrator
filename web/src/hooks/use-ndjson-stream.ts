/** NDJSON 스트리밍 훅 — rAF 배치 플러시로 메인 스레드 블록 방지. */

import { useState, useRef, useCallback, useEffect } from "react";

type NdjsonLine =
  | { type: "start" }
  | { type: "delta"; content: string }
  | { type: "thinking"; tokens: number; preview: string }
  | { type: "tool_start"; id: string; name: string; params?: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: string; is_error?: boolean }
  | { type: "usage"; input: number; output: number; cache_read?: number; cache_creation?: number; cost_usd?: number | null }
  | { type: "rate_limit"; status: string }
  | { type: "compact"; pre_tokens: number }
  | { type: "routing"; requested_channel?: string; delivered_channel?: string; session_reuse?: boolean }
  | { type: "heartbeat" }
  | { type: "done" }
  | { type: "error"; error: string };

export type ToolCallEntry = {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  done: boolean;
  result?: string;
  is_error?: boolean;
};

export type ThinkingEntry = {
  tokens: number;
  preview: string;
};

export type NdjsonStream = { chat_id: string; content: string; done: boolean };

export type UsageEntry = {
  input: number;
  output: number;
  cache_read?: number;
  cache_creation?: number;
  cost_usd?: number | null;
};

/** 백엔드가 메시지 처리 시작 시 전송하는 라우팅 결정 정보. */
export type RoutingInfo = {
  requested_channel?: string | null;
  delivered_channel?: string | null;
  session_reuse?: boolean;
};

export function useNdjsonStream() {
  const [stream, setStream] = useState<NdjsonStream | null>(null);
  const [tool_calls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [thinking_blocks, setThinkingBlocks] = useState<ThinkingEntry[]>([]);
  const [rate_limit_status, setRateLimitStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageEntry | null>(null);
  const [compacted, setCompacted] = useState(false);
  const [routing, setRouting] = useState<RoutingInfo | null>(null);
  const tool_map_ref = useRef<Map<string, ToolCallEntry>>(new Map());
  const buffer_ref = useRef<string[]>([]);
  const abort_ref = useRef<AbortController | null>(null);
  /** rAF 중복 스케줄 방지 플래그. */
  const flush_scheduled_ref = useRef(false);
  /** tool_map이 변경되어 setToolCalls가 필요한지 여부. */
  const tool_dirty_ref = useRef(false);

  /** 버퍼된 delta + dirty tool_calls를 한 번에 React 상태에 반영.
   *  두 번 호출되어도 안전 — 빈 버퍼/false dirty는 noop. */
  const flush = useCallback(() => {
    const buffered = buffer_ref.current.splice(0);
    if (buffered.length > 0) {
      setStream((prev) => prev ? { ...prev, content: prev.content + buffered.join("") } : null);
    }
    if (tool_dirty_ref.current) {
      tool_dirty_ref.current = false;
      setToolCalls([...tool_map_ref.current.values()]);
    }
  }, []);

  /** rAF 한 프레임(~16ms)당 최대 1회 flush — 토큰마다 리렌더 방지. */
  const schedule_flush = useCallback(() => {
    if (flush_scheduled_ref.current) return;
    flush_scheduled_ref.current = true;
    requestAnimationFrame(() => {
      flush_scheduled_ref.current = false;
      flush();
    });
  }, [flush]);

  // 탭이 다시 보이면 버퍼에 쌓인 delta를 한번에 반영
  useEffect(() => {
    const on_visible = () => { if (document.visibilityState === "visible") flush(); };
    document.addEventListener("visibilitychange", on_visible);
    return () => document.removeEventListener("visibilitychange", on_visible);
  }, [flush]);

  /** NDJSON 스트림 시작. resolve 시 스트림 완료, reject 시 오류. */
  const start = useCallback(async (chat_id: string, body: Record<string, unknown>): Promise<void> => {
    abort_ref.current?.abort();
    const controller = new AbortController();
    abort_ref.current = controller;
    buffer_ref.current = [];
    tool_map_ref.current.clear();
    flush_scheduled_ref.current = false;
    tool_dirty_ref.current = false;
    setStream({ chat_id, content: "", done: false });
    setToolCalls([]);
    setThinkingBlocks([]);
    setRateLimitStatus(null);
    setUsage(null);
    setCompacted(false);
    setRouting(null);

    try {
      const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(chat_id)}/messages/stream`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let leftover = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        leftover += decoder.decode(value, { stream: true });
        const lines = leftover.split("\n");
        leftover = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as NdjsonLine;
            if (msg.type === "delta") {
              buffer_ref.current.push(msg.content);
              // 탭 숨김 시 버퍼만 쌓고, 보일 때는 rAF로 배치 플러시
              if (document.visibilityState !== "hidden") schedule_flush();
            } else if (msg.type === "thinking") {
              setThinkingBlocks((prev) => [...prev, { tokens: msg.tokens, preview: msg.preview }]);
            } else if (msg.type === "tool_start") {
              const entry: ToolCallEntry = { id: msg.id, name: msg.name, params: msg.params, done: false };
              tool_map_ref.current.set(msg.id, entry);
              tool_dirty_ref.current = true;
              schedule_flush();
            } else if (msg.type === "tool_result") {
              const prev_entry = tool_map_ref.current.get(msg.id);
              const updated: ToolCallEntry = prev_entry
                ? { ...prev_entry, done: true, result: msg.result, is_error: msg.is_error }
                : { id: msg.id, name: msg.name, done: true, result: msg.result, is_error: msg.is_error };
              tool_map_ref.current.set(msg.id, updated);
              tool_dirty_ref.current = true;
              schedule_flush();
            } else if (msg.type === "rate_limit") {
              setRateLimitStatus(msg.status);
            } else if (msg.type === "usage") {
              setUsage({ input: msg.input, output: msg.output, cache_read: msg.cache_read, cache_creation: msg.cache_creation, cost_usd: msg.cost_usd });
            } else if (msg.type === "compact") {
              setCompacted(true);
            } else if (msg.type === "routing") {
              setRouting({ requested_channel: msg.requested_channel, delivered_channel: msg.delivered_channel, session_reuse: msg.session_reuse });
            } else if (msg.type === "done") {
              // done 시 동기 플러시 — rAF 대기 없이 최종 상태 즉시 반영
              flush();
              setStream((prev) => prev ? { ...prev, done: true } : null);
            } else if (msg.type === "error") {
              setStream(null);
              throw new Error(msg.error);
            }
          } catch (parse_err) {
            if ((parse_err as { message?: string }).message && !(parse_err instanceof SyntaxError)) throw parse_err;
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setStream(null);
      throw e;
    }
  }, [flush, schedule_flush]);

  const cancel = useCallback(() => {
    abort_ref.current?.abort();
    setStream(null);
  }, []);

  return { stream, tool_calls, thinking_blocks, rate_limit_status, usage, compacted, routing, start, cancel };
}
