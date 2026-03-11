/** PtyTransport — Pty 기반 AgentTransport 구현. AgentBus에서 추출한 연결 관리 + I/O 로직. */

import type { Logger } from "../../logger.js";
import type {
  Pty, AgentInputMessage, AgentOutputMessage, AgentTransport,
  Disposable, BuildArgsOptions, CliAdapter,
} from "./types.js";
import { NdjsonParser } from "./ndjson-parser.js";
import { ContainerPool } from "./container-pool.js";

export type PtyTransportOptions = {
  pool: ContainerPool;
  adapter: CliAdapter;
  logger: Logger;
};

type PtyConnection = {
  pty: Pty;
  parser: NdjsonParser;
  subscriptions: Disposable[];
};

export class PtyTransport implements AgentTransport {
  private readonly pool: ContainerPool;
  private readonly adapter: CliAdapter;
  private readonly _logger: Logger;
  private readonly connections = new Map<string, PtyConnection>();
  private readonly output_handlers = new Set<(key: string, msg: AgentOutputMessage) => void>();

  constructor(options: PtyTransportOptions) {
    this.pool = options.pool;
    this.adapter = options.adapter;
    this._logger = options.logger;
  }

  async send(
    session_key: string,
    msg: AgentInputMessage,
    args_options: BuildArgsOptions,
    env?: Record<string, string>,
  ): Promise<AgentOutputMessage> {
    const conn = this.ensure_connection(session_key, args_options, env);
    const payload = this.adapter.format_input(msg);

    if (this.adapter.stdin_mode === "close") {
      conn.pty.end(payload);
    } else {
      conn.pty.write(payload);
    }

    this.pool.touch(session_key);
    return this.wait_for_terminal(session_key);
  }

  on_output(handler: (key: string, msg: AgentOutputMessage) => void): Disposable {
    this.output_handlers.add(handler);
    return { dispose: () => { this.output_handlers.delete(handler); } };
  }

  /** Steer Mode: 실행 중인 PTY stdin에 직접 쓰기. 연결이 없으면 false 반환. */
  write_stdin(session_key: string, text: string): boolean {
    const conn = this.connections.get(session_key);
    if (!conn) return false;
    conn.pty.write(text);
    return true;
  }

  list_sessions(): string[] {
    return [...this.connections.keys()];
  }

  async remove_session(session_key: string): Promise<void> {
    const conn = this.connections.get(session_key);
    if (conn) {
      for (const sub of conn.subscriptions) sub.dispose();
      this.connections.delete(session_key);
    }
    await this.pool.remove(session_key);
  }

  async shutdown(): Promise<void> {
    for (const [key, conn] of this.connections) {
      for (const sub of conn.subscriptions) sub.dispose();
      this.connections.delete(key);
    }
    await this.pool.shutdown();
  }

  private ensure_connection(
    session_key: string,
    args_options?: BuildArgsOptions,
    env?: Record<string, string>,
  ): PtyConnection {
    const existing = this.connections.get(session_key);
    if (existing) return existing;

    const pty = this.pool.ensure_running(session_key, args_options, env);
    const parser = new NdjsonParser(this.adapter);

    const data_sub = pty.onData((chunk) => {
      const messages = parser.feed(chunk);
      for (const msg of messages) this.emit_output(session_key, msg);
    });

    const exit_sub = pty.onExit(() => {
      const remaining = parser.flush();
      for (const msg of remaining) this.emit_output(session_key, msg);
      this.connections.delete(session_key);
    });

    const conn: PtyConnection = { pty, parser, subscriptions: [data_sub, exit_sub] };
    this.connections.set(session_key, conn);
    return conn;
  }

  private emit_output(session_key: string, msg: AgentOutputMessage): void {
    for (const handler of this.output_handlers) {
      try { handler(session_key, msg); }
      catch { /* 옵저버 실패가 전송 계층을 차단하면 안 됨 */ }
    }
  }

  /** PTY 응답을 기다리는 최대 시간(ms). LLM 응답 대기를 포함해 넉넉히 설정. */
  private static readonly TERMINAL_TIMEOUT_MS = 5 * 60_000;

  private wait_for_terminal(session_key: string): Promise<AgentOutputMessage> {
    return new Promise<AgentOutputMessage>((resolve) => {
      let resolved = false;
      const cleanup = () => {
        resolved = true;
        clearTimeout(timeout);
        output_sub.dispose();
        exit_sub.dispose();
      };

      const timeout = setTimeout(() => {
        if (resolved) return;
        cleanup();
        this._logger.warn(`wait_for_terminal timeout session=${session_key}`);
        resolve({ type: "error", code: "timeout", message: "pty terminal wait timed out" });
      }, PtyTransport.TERMINAL_TIMEOUT_MS);

      const output_sub = this.on_output((key, msg) => {
        if (resolved || key !== session_key) return;
        if (msg.type === "complete" || msg.type === "error") {
          cleanup();
          resolve(msg);
        }
      });

      const pty = this.pool.get(session_key);
      const exit_sub = pty
        ? pty.onExit(() => {
            if (resolved) return;
            setTimeout(() => {
              if (resolved) return;
              cleanup();
              resolve({ type: "error", code: "crash", message: "pty exited without terminal message" });
            }, 50);
          })
        : { dispose: () => {} };

      if (!pty) {
        cleanup();
        resolve({ type: "error", code: "crash", message: "pty not found for session" });
      }
    });
  }
}
