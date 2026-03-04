import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import { now_iso, error_message} from "../utils/common.js";
import type { OpsRuntimeDeps, OpsRuntimeStatus } from "./types.js";

export class OpsRuntimeService implements ServiceLike {
  readonly name = "ops-runtime";
  private readonly deps: OpsRuntimeDeps;
  private readonly logger: Logger | null;
  private readonly health_log_enabled: boolean;
  private readonly health_log_on_change: boolean;
  private readonly bridge_pump_enabled: boolean;
  private last_health_signature = "";
  private readonly status_state: OpsRuntimeStatus = {
    running: false,
    startup_logged: false,
  };

  constructor(deps: OpsRuntimeDeps, ops_config?: { healthLogEnabled?: boolean; healthLogOnChange?: boolean; bridgePumpEnabled?: boolean }) {
    this.deps = deps;
    this.logger = deps.logger ?? null;
    this.health_log_enabled = ops_config?.healthLogEnabled ?? false;
    this.health_log_on_change = ops_config?.healthLogOnChange ?? true;
    this.bridge_pump_enabled = ops_config?.bridgePumpEnabled ?? false;
  }

  async start(): Promise<void> {
    if (this.status_state.running) return;
    this.status_state.running = true;
    await this.startup_changelog();
    this.deps.cron.every(20_000, async () => this.health_tick());
    this.deps.cron.every(45_000, async () => this.watchdog_tick());
    this.deps.cron.every(5_000, async () => this.bridge_pump_tick());
    this.deps.cron.every(5 * 60_000, async () => this.decision_dedupe_tick());
    this.deps.cron.every(30 * 60_000, async () => this.secret_prune_tick());
  }

  async stop(): Promise<void> {
    this.status_state.running = false;
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this.status_state.running };
  }

  status(): OpsRuntimeStatus {
    return { ...this.status_state };
  }

  private async startup_changelog(): Promise<void> {
    if (this.status_state.startup_logged) return;
    this.status_state.startup_logged = true;
    this.logger?.info(`startup ${now_iso()}`);
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
        this.logger?.info(
          `health queue(in=${q.inbound},out=${q.outbound}) channels=${channelStatus.enabled_channels.join(",")} mention_loop=${channelStatus.mention_loop_running} heartbeat=${heartbeat.enabled}`,
        );
      }
    }
    this.last_health_signature = signature;
    this.status_state.last_health_at = now_iso();
  }

  private async watchdog_tick(): Promise<void> {
    if (!this.status_state.running) return;
    if (this.deps.services) {
      try {
        const results = await this.deps.services.health_check();
        const unhealthy = results.filter((r) => !r.ok);
        if (unhealthy.length > 0) {
          this.logger?.warn(`watchdog: unhealthy services`, { services: unhealthy.map((s) => s.name) });
        }
      } catch (error) {
        this.logger?.error(`watchdog health_check failed: ${error_message(error)}`);
      }
    }
    this.status_state.last_watchdog_at = now_iso();
  }

  private async bridge_pump_tick(): Promise<void> {
    if (!this.status_state.running) return;
    if (this.bridge_pump_enabled) {
      try {
        const inbound = await this.deps.bus.consume_inbound({ timeout_ms: 20 });
        if (inbound) {
          await this.deps.channels.handle_inbound_message(inbound);
        }
      } catch (error) {
        this.logger?.error(`bridge pump failed: ${error_message(error)}`);
      }
    }
    this.status_state.last_bridge_pump_at = now_iso();
  }

  private async decision_dedupe_tick(): Promise<void> {
    if (!this.status_state.running) return;
    try {
      const result = await this.deps.decisions.dedupe_decisions();
      if (result.removed > 0) {
        this.logger?.info(`decision dedupe removed=${result.removed} active=${result.active}`);
      }
    } catch (error) {
      this.logger?.error(`decision dedupe failed: ${error_message(error)}`);
    }
    if (this.deps.promises) {
      try {
        const result = await this.deps.promises.dedupe_promises();
        if (result.removed > 0) {
          this.logger?.info(`promise dedupe removed=${result.removed} active=${result.active}`);
        }
      } catch (error) {
        this.logger?.error(`promise dedupe failed: ${error_message(error)}`);
      }
    }
    this.status_state.last_decision_dedupe_at = now_iso();
  }

  private async secret_prune_tick(): Promise<void> {
    if (!this.status_state.running || !this.deps.secret_vault) return;
    try {
      const removed = await this.deps.secret_vault.prune_expired(6 * 3_600_000);
      if (removed > 0) this.logger?.info(`secret prune removed=${removed}`);
    } catch (error) {
      this.logger?.error(`secret prune failed: ${error_message(error)}`);
    }
    if (this.deps.session_store?.prune_expired) {
      try {
        const removed = await this.deps.session_store.prune_expired(24 * 3_600_000);
        if (removed > 0) this.logger?.info(`session prune removed=${removed}`);
      } catch (error) {
        this.logger?.error(`session prune failed: ${error_message(error)}`);
      }
    }
    if (this.deps.dlq?.prune_older_than) {
      try {
        const removed = await this.deps.dlq.prune_older_than(7 * 24 * 3_600_000);
        if (removed > 0) this.logger?.info(`dlq prune removed=${removed}`);
      } catch (error) {
        this.logger?.error(`dlq prune failed: ${error_message(error)}`);
      }
    }
  }
}
