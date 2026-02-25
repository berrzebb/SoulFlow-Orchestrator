import { now_iso } from "../utils/common.js";
import type { InboundMessage } from "../bus/types.js";
import type { OpsRuntimeDeps, OpsRuntimeStatus } from "./types.js";

type RecoveryTarget = {
  provider: "slack" | "discord" | "telegram";
  chat_id: string;
  alias: string;
};

function parse_recovery_target(task_id: string): RecoveryTarget | null {
  const raw = String(task_id || "").trim().toLowerCase();
  // Expected format: task:{provider}:{chat_id}:{alias}
  const m = raw.match(/^task:(slack|discord|telegram):([^:]+):(.+)$/i);
  if (!m) return null;
  const provider = String(m[1] || "").toLowerCase() as RecoveryTarget["provider"];
  const chat_id = String(m[2] || "").trim();
  const alias = String(m[3] || "").trim() || "assistant";
  if (!chat_id) return null;
  return { provider, chat_id, alias };
}

export class OpsRuntimeService {
  private readonly deps: OpsRuntimeDeps;
  private readonly health_log_enabled: boolean;
  private readonly health_log_on_change: boolean;
  private readonly recovery_interval_ms: number;
  private readonly recovery_batch_size: number;
  private readonly recovery_enabled: boolean;
  private readonly recovery_last_attempt = new Map<string, number>();
  private last_health_signature = "";
  private readonly status_state: OpsRuntimeStatus = {
    running: false,
    startup_logged: false,
  };

  constructor(deps: OpsRuntimeDeps) {
    this.deps = deps;
    this.health_log_enabled = String(process.env.OPS_HEALTH_LOG_ENABLED || "0").trim() === "1";
    this.health_log_on_change = String(process.env.OPS_HEALTH_LOG_ON_CHANGE || "1").trim() !== "0";
    this.recovery_enabled = String(process.env.TASK_RECOVERY_ENABLED || "1").trim() !== "0";
    this.recovery_interval_ms = Math.max(30_000, Number(process.env.TASK_RECOVERY_RETRY_MS || 120_000));
    this.recovery_batch_size = Math.max(1, Number(process.env.TASK_RECOVERY_BATCH || 2));
  }

  async start(): Promise<void> {
    if (this.status_state.running) return;
    this.status_state.running = true;
    await this.startup_changelog();
    this.deps.cron.every(20_000, async () => this.health_tick());
    this.deps.cron.every(45_000, async () => this.watchdog_tick());
    this.deps.cron.every(5_000, async () => this.bridge_pump_tick());
    this.deps.cron.every(5 * 60_000, async () => this.decision_dedupe_tick());
  }

  async stop(): Promise<void> {
    this.status_state.running = false;
  }

  status(): OpsRuntimeStatus {
    return { ...this.status_state };
  }

  private async startup_changelog(): Promise<void> {
    if (this.status_state.startup_logged) return;
    this.status_state.startup_logged = true;
    // eslint-disable-next-line no-console
    console.log(`[ops] startup ${now_iso()}`);
  }

  private async health_tick(): Promise<void> {
    if (!this.status_state.running) return;
    const q = this.deps.bus.get_sizes();
    const channelStatus = this.deps.channels.get_status();
    const heartbeat = this.deps.heartbeat.status();
    const signature = `in=${q.inbound}|out=${q.outbound}|channels=${channelStatus.enabled_channels.join(",")}|mention=${channelStatus.mention_loop_running}|heartbeat=${heartbeat.enabled}`;
    if (this.health_log_enabled) {
      const changed = signature !== this.last_health_signature;
      if (!this.health_log_on_change || changed) {
        // eslint-disable-next-line no-console
        console.log(
          `[ops] health queue(in=${q.inbound},out=${q.outbound}) channels=${channelStatus.enabled_channels.join(",")} mention_loop=${channelStatus.mention_loop_running} heartbeat=${heartbeat.enabled}`,
        );
      }
    }
    this.last_health_signature = signature;
    this.status_state.last_health_at = now_iso();
  }

  private async watchdog_tick(): Promise<void> {
    if (!this.status_state.running) return;
    const resumable = await this.deps.agent.task_recovery.list_resumable();
    if (resumable.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[ops] watchdog resumable_tasks=${resumable.length}`);
    }
    if (this.recovery_enabled && resumable.length > 0) {
      await this.try_resume_resumable_tasks();
    }
    this.status_state.last_watchdog_at = now_iso();
  }

  private async try_resume_resumable_tasks(): Promise<void> {
    const rows = await this.deps.agent.task_recovery.list_resumable();
    if (rows.length === 0) return;
    let attempted = 0;
    for (const task of rows) {
      if (attempted >= this.recovery_batch_size) break;
      // waiting_approval should be resumed by explicit approval response.
      if (task.status === "waiting_approval") continue;
      const target = parse_recovery_target(task.taskId);
      if (!target) continue;
      const now = Date.now();
      const last = Number(this.recovery_last_attempt.get(task.taskId) || 0);
      if (now - last < this.recovery_interval_ms) continue;
      this.recovery_last_attempt.set(task.taskId, now);
      attempted += 1;
      const objective = String(task.memory?.objective || task.title || "resume task").trim();
      const inbound: InboundMessage = {
        id: `recovery-${task.taskId}-${now}`,
        provider: target.provider,
        channel: target.provider,
        sender_id: "recovery",
        chat_id: target.chat_id,
        content: `[workflow resume]\n${objective}`,
        at: new Date().toISOString(),
        metadata: {
          kind: "task_recovery",
          recovery_task_id: task.taskId,
          message_id: `recovery-${task.taskId}-${now}`,
        },
      };
      try {
        await this.deps.channels.handle_inbound_message(inbound);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `[ops] recovery failed task=${task.taskId} err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async bridge_pump_tick(): Promise<void> {
    if (!this.status_state.running) return;
    // Disabled by default: direct channel polling already handles inbound routing.
    // Enable only for explicit recovery diagnostics.
    const enabled = String(process.env.ENABLE_BRIDGE_PUMP || "0").trim() === "1";
    if (enabled) {
      try {
        const inbound = await this.deps.bus.consume_inbound({ timeout_ms: 20 });
        if (inbound) {
          await this.deps.channels.handle_inbound_message(inbound);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[ops] bridge pump failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.status_state.last_bridge_pump_at = now_iso();
  }

  private async decision_dedupe_tick(): Promise<void> {
    if (!this.status_state.running) return;
    try {
      const result = await this.deps.decisions.dedupe_decisions();
      if (result.removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ops] decision dedupe removed=${result.removed} active=${result.active}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[ops] decision dedupe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.status_state.last_decision_dedupe_at = now_iso();
  }
}
