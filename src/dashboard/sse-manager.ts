/** SSE 클라이언트 관리 + 브로드캐스트. service.ts에서 분리. */

import type { ServerResponse } from "node:http";
import type { ProcessEntry } from "../orchestration/process-tracker.js";
import type { TaskState } from "../contracts.js";
import type { ProgressEvent } from "../bus/types.js";
import type { AgentEvent } from "../agent/agent.types.js";
import type { RecentMessage } from "./service.js";
import type { SseBroadcasterLike } from "./broadcaster.js";
import { now_iso, short_id } from "../utils/common.js";
import { set_no_cache } from "./route-context.js";
import { pick_agent_event_fields } from "./state-builder.js";

type SseClient = { id: string; res: ServerResponse };

const MAX_RECENT_MESSAGES = 40;

export class SseManager implements SseBroadcasterLike {
  private readonly clients = new Map<string, SseClient>();
  readonly recent_messages: RecentMessage[] = [];

  get client_count(): number { return this.clients.size; }

  add_client(res: ServerResponse): void {
    const id = short_id(8);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    set_no_cache(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ id, at: now_iso() })}\n\n`);
    this.clients.set(id, { id, res });
    res.on("close", () => { this.clients.delete(id); });
  }

  close_all(): void {
    for (const client of this.clients.values()) client.res.end();
    this.clients.clear();
  }

  broadcast_process_event(type: "start" | "end", entry: ProcessEntry): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: process\ndata: ${JSON.stringify({ type, run_id: entry.run_id, alias: entry.alias, mode: entry.mode, status: entry.status, at: now_iso() })}\n\n`);
  }

  broadcast_message_event(direction: "inbound" | "outbound", sender_id: string, content?: string, chat_id?: string): void {
    const at = now_iso();
    this.recent_messages.push({ direction, sender_id, content: String(content || "").slice(0, 200), chat_id: chat_id || "", at });
    while (this.recent_messages.length > MAX_RECENT_MESSAGES) this.recent_messages.shift();
    if (this.clients.size === 0) return;
    this._broadcast(`event: message\ndata: ${JSON.stringify({ direction, sender_id, at })}\n\n`);
  }

  broadcast_cron_event(type: string, job_id?: string): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: cron\ndata: ${JSON.stringify({ type, job_id: job_id ?? null, at: now_iso() })}\n\n`);
  }

  broadcast_progress_event(event: ProgressEvent): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
  }

  broadcast_task_event(type: "status_change", task: TaskState): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: task\ndata: ${JSON.stringify({ type, taskId: task.taskId, title: task.title, status: task.status, exitReason: task.exitReason, currentStep: task.currentStep, currentTurn: task.currentTurn, maxTurns: task.maxTurns, channel: task.channel, chatId: task.chatId, objective: (task.objective || "").slice(0, 200), at: now_iso() })}\n\n`);
  }

  broadcast_web_stream(chat_id: string, content: string, done: boolean): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: web_stream\ndata: ${JSON.stringify({ chat_id, content, done })}\n\n`);
  }

  broadcast_mirror_message(event: { session_key: string; direction: string; sender_id: string; content: string; at: string }): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: mirror_message\ndata: ${JSON.stringify(event)}\n\n`);
  }

  broadcast_workflow_event(event: import("../agent/phase-loop.types.js").PhaseLoopEvent): void {
    if (this.clients.size === 0) return;
    this._broadcast(`event: workflow\ndata: ${JSON.stringify({ ...event, at: now_iso() })}\n\n`);
  }

  broadcast_agent_event(event: AgentEvent): void {
    if (this.clients.size === 0) return;
    const slim = { type: event.type, backend: event.source.backend, task_id: event.source.task_id, at: event.at, ...pick_agent_event_fields(event) };
    this._broadcast(`event: agent\ndata: ${JSON.stringify(slim)}\n\n`);
  }

  private _broadcast(payload: string): void {
    const dead: string[] = [];
    for (const [id, client] of this.clients.entries()) {
      try { client.res.write(payload); } catch { dead.push(id); }
    }
    for (const id of dead) this.clients.delete(id);
  }
}
