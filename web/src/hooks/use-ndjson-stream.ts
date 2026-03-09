/** NDJSON 스트리밍 훅 — Fetch ReadableStream 기반, 탭 숨김 시 버퍼링. */

import { useState, useRef, useCallback, useEffect } from "react";

type NdjsonLine =
  | { type: "start" }
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; error: string };

export type NdjsonStream = { chat_id: string; content: string; done: boolean };

export function useNdjsonStream() {
  const [stream, setStream] = useState<NdjsonStream | null>(null);
  const buffer_ref = useRef<string[]>([]);
  const abort_ref = useRef<AbortController | null>(null);

  const flush = useCallback(() => {
    const buffered = buffer_ref.current.splice(0);
    if (buffered.length === 0) return;
    setStream((prev) => prev ? { ...prev, content: prev.content + buffered.join("") } : null);
  }, []);

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
    setStream({ chat_id, content: "", done: false });

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
              if (document.visibilityState === "hidden") {
                buffer_ref.current.push(msg.content);
              } else {
                const buffered = buffer_ref.current.splice(0);
                const appended = [...buffered, msg.content].join("");
                setStream((prev) => prev ? { ...prev, content: prev.content + appended } : null);
              }
            } else if (msg.type === "done") {
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
  }, [flush]);

  const cancel = useCallback(() => {
    abort_ref.current?.abort();
    setStream(null);
  }, []);

  return { stream, start, cancel };
}
