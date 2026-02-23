import type { AgentDomain } from "../agent/index.js";
import type { MessageBus } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { CronService } from "../cron/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { DecisionService } from "../decision/index.js";

export type OpsRuntimeDeps = {
  bus: MessageBus;
  channels: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  agent: AgentDomain;
  decisions: DecisionService;
};

export type OpsRuntimeStatus = {
  running: boolean;
  startup_logged: boolean;
  last_health_at?: string;
  last_watchdog_at?: string;
  last_bridge_pump_at?: string;
  last_decision_dedupe_at?: string;
};
