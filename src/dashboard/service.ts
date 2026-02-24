import { createReadStream, existsSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDomain } from "../agent/index.js";
import type { MessageBus } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { DecisionService } from "../decision/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import { now_iso } from "../utils/common.js";

type DashboardOptions = {
  host: string;
  port: number;
  workspace: string;
  assets_dir?: string;
  agent: AgentDomain;
  bus: MessageBus;
  channels: ChannelManager;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
  decisions: DecisionService;
  events: WorkflowEventService;
};

type SseClient = {
  id: string;
  res: ServerResponse;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function rand_id(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extname(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

function set_no_cache(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export class DashboardService {
  private readonly options: DashboardOptions;
  private readonly root_dir: string;
  private server: Server | null = null;
  private watcher: FSWatcher | null = null;
  private readonly sse_clients = new Map<string, SseClient>();

  constructor(options: DashboardOptions) {
    this.options = options;
    this.root_dir = this.resolve_root_dir(options);
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.options.port, this.options.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    this.start_watcher();
  }

  async stop(): Promise<void> {
    this.stop_watcher();
    for (const client of this.sse_clients.values()) {
      client.res.end();
    }
    this.sse_clients.clear();
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private start_watcher(): void {
    if (this.watcher || !existsSync(this.root_dir)) return;
    this.watcher = watch(this.root_dir, { recursive: true }, (_event, file) => {
      this.broadcast_reload(file ? String(file) : "");
    });
  }

  private stop_watcher(): void {
    if (!this.watcher) return;
    this.watcher.close();
    this.watcher = null;
  }

  private broadcast_reload(file: string): void {
    const payload = `event: reload\ndata: ${JSON.stringify({ file, at: now_iso() })}\n\n`;
    for (const client of this.sse_clients.values()) {
      client.res.write(payload);
    }
  }

  private async build_state(): Promise<Record<string, unknown>> {
    const queue = this.options.bus.get_sizes();
    const channel_status = this.options.channels.get_status();
    const ops = this.options.ops.status();
    const heartbeat = this.options.heartbeat.status();
    const tasks = this.options.agent.loop.list_tasks().map((t) => ({
      taskId: t.taskId,
      status: t.status,
      currentStep: t.currentStep,
      updatedAt: t.memory?.__updated_at_seoul || "",
    }));
    const subagents = this.options.agent.subagents.list();
    const messages = this.options.bus.peek(40).slice(0, 20).map((m) => ({
      sender_id: m.sender_id,
      content: String(m.content || "").slice(0, 200),
      at: m.at,
      chat_id: m.chat_id,
    }));
    const lastBySender = new Map<string, string>();
    for (const m of messages) {
      lastBySender.set(m.sender_id, m.content);
    }

    const agents = subagents.map((a) => ({
      id: a.id,
      label: a.label || a.id,
      role: a.role,
      status: a.status,
      updated_at: a.updated_at,
      last_message: lastBySender.get(`subagent:${a.id}`) || "",
    }));
    const decisions = await this.options.decisions.get_effective_decisions({ include_p2: true });
    const workflow_events = await this.options.events.list({ limit: 40 });

    return {
      now: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", "T") + "+09:00",
      queue,
      channels: {
        enabled: channel_status.enabled_channels,
        mention_loop_running: channel_status.mention_loop_running,
      },
      heartbeat,
      ops,
      agents,
      tasks,
      messages,
      decisions: decisions.map((d) => ({
        id: d.id,
        canonical_key: d.canonical_key,
        value: d.value,
        priority: d.priority,
      })),
      workflow_events: workflow_events.map((e) => ({
        event_id: e.event_id,
        task_id: e.task_id,
        run_id: e.run_id,
        agent_id: e.agent_id,
        phase: e.phase,
        summary: e.summary,
        at: e.at,
      })),
    };
  }

  private resolve_root_dir(options: DashboardOptions): string {
    const module_dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      String(options.assets_dir || ""),
      join(options.workspace, "dashboard"),
      join(options.workspace, "..", "dashboard"),
      join(module_dir, "../../dashboard"),
      join(process.cwd(), "dashboard"),
    ]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .map((p) => resolve(p));

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return resolve(options.assets_dir || join(options.workspace, "dashboard"));
  }

  private serve_file(res: ServerResponse, relative_path: string): void {
    const safe = normalize(relative_path).replace(/^(\.\.[/\\])+/, "");
    const abs = join(this.root_dir, safe);
    if (!existsSync(abs)) {
      res.statusCode = 404;
      res.end("not_found");
      return;
    }
    const ext = extname(abs);
    res.statusCode = 200;
    set_no_cache(res);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    createReadStream(abs).pipe(res);
  }

  private add_sse_client(res: ServerResponse): void {
    const id = rand_id();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    set_no_cache(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ id, at: now_iso() })}\n\n`);
    const client: SseClient = { id, res };
    this.sse_clients.set(id, client);
    res.on("close", () => {
      this.sse_clients.delete(id);
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${this.options.host}:${this.options.port}`);
    if (url.pathname === "/api/state") {
      set_no_cache(res);
      const state = await this.build_state();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === "/api/events") {
      this.add_sse_client(res);
      return;
    }
    if (url.pathname === "/healthz") {
      set_no_cache(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, at: now_iso() }));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      this.serve_file(res, "index.html");
      return;
    }
    this.serve_file(res, url.pathname.replace(/^\//, ""));
  }
}
