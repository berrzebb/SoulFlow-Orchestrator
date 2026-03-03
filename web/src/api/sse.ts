type SseHandler = (data: unknown) => void;

export function create_sse(path: string, handlers: Record<string, SseHandler>): { close: () => void } {
  let es: EventSource | null = null;
  let reconnect_timer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    es = new EventSource(path);
    for (const [event, handler] of Object.entries(handlers)) {
      es.addEventListener(event, (e) => {
        try { handler(JSON.parse((e as MessageEvent).data)); } catch { /* skip */ }
      });
    }
    es.onerror = () => {
      es?.close();
      reconnect_timer = setTimeout(connect, 3000);
    };
  }

  connect();

  return {
    close() {
      if (reconnect_timer) clearTimeout(reconnect_timer);
      es?.close();
      es = null;
    },
  };
}
