import { short_id } from "../../utils/common.js";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/** JSON-RPC 2.0 요청. */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

/** JSON-RPC 2.0 응답. */
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC 2.0 알림 (id 없음). */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Codex CLI의 app-server 모드와 stdio로 JSON-RPC 2.0 통신하는 클라이언트.
 * 프로세스 lifecycle, 메시지 파싱, 요청/응답 매칭을 관리.
 */
export class CodexJsonRpcClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private buffer = "";

  constructor(private readonly config: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    request_timeout_ms?: number;
  }) {
    super();
  }

  /** app-server 프로세스를 시작. */
  start(): void {
    if (this.process) return;

    const env = { ...process.env, ...this.config.env };
    this.process = spawn(this.config.command, this.config.args || [], {
      cwd: this.config.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this._on_data(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString("utf-8"));
    });

    this.process.on("exit", (code) => {
      this._reject_all(new Error(`codex_process_exit:${code}`));
      this.process = null;
      this.emit("exit", code);
    });

    this.process.on("error", (err) => {
      this._reject_all(err);
      this.emit("error", err);
    });
  }

  /** JSON-RPC 요청을 보내고 응답을 대기. */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      throw new Error("codex_process_not_running");
    }

    const id = short_id();
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const timeout = this.config.request_timeout_ms || 30_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex_request_timeout:${method}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  /** JSON-RPC notification 전송 (id 없음, 응답 대기 없음). */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  /** 프로세스 종료. */
  stop(): void {
    this._reject_all(new Error("codex_client_stopped"));
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  is_running(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /** newline-delimited JSON 파싱. 버퍼 최대 10MB. */
  private _on_data(chunk: string): void {
    this.buffer += chunk;
    // 버퍼 무한 성장 방지 (개행 없이 10MB 이상 → 버퍼 초기화)
    if (this.buffer.length > 10_000_000) {
      this.emit("parse_error", `buffer_overflow:${this.buffer.length}`);
      this.buffer = "";
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        this._dispatch(parsed);
      } catch {
        this.emit("parse_error", trimmed);
      }
    }
  }

  /** 서버가 보낸 요청(id+method, 응답 필요)에 대해 결과를 반환. */
  respond(id: string | number, result: unknown): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  /** 응답, 서버 요청, 알림을 분류하여 처리. */
  private _dispatch(msg: Record<string, unknown>): void {
    const has_id = msg.id != null;
    const has_method = typeof msg.method === "string";

    // 응답: id가 있고 pending에 매칭
    if (has_id && this.pending.has(String(msg.id))) {
      const pending = this.pending.get(String(msg.id))!;
      this.pending.delete(String(msg.id));
      clearTimeout(pending.timer);

      if (msg.error) {
        const err = msg.error as { code: number; message: string };
        pending.reject(new Error(`codex_rpc_error:${err.code}:${err.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 서버 요청: id+method가 있지만 우리가 보낸 요청이 아님 → 응답이 필요한 요청
    if (has_id && has_method) {
      this.emit("server_request", {
        id: msg.id,
        method: msg.method as string,
        params: (msg.params || {}) as Record<string, unknown>,
      });
      return;
    }

    // 알림: method만 있고 id 없음
    if (has_method) {
      this.emit("notification", {
        method: msg.method as string,
        params: (msg.params || {}) as Record<string, unknown>,
      });
      return;
    }

    this.emit("unknown_message", msg);
  }

  private _reject_all(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
