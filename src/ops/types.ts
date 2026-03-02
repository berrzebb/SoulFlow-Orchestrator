import type { MessageBusLike } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { CronScheduler } from "../cron/contracts.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { DecisionService } from "../decision/index.js";
import type { ServiceManager } from "../runtime/service-manager.js";

export type OpsRuntimeDeps = {
  bus: MessageBusLike;
  channels: ChannelManager;
  cron: CronScheduler;
  heartbeat: HeartbeatService;
  decisions: DecisionService;
  /** 전체 서비스 health_check 수행용. 없으면 watchdog 스킵. */
  services?: ServiceManager | null;
  /** SecretVault 만료 정리용. */
  secret_vault?: import("../security/secret-vault.js").SecretVaultLike | null;
  /** SessionStore 만료 정리용. */
  session_store?: import("../session/service.js").SessionStoreLike | null;
  /** PromiseService 중복 정리용. */
  promises?: import("../decision/promise.service.js").PromiseService | null;
  /** DLQ 만료 정리용. */
  dlq?: import("../channels/dlq-store.js").DispatchDlqStoreLike | null;
  logger?: import("../logger.js").Logger | null;
};

export type OpsRuntimeStatus = {
  running: boolean;
  startup_logged: boolean;
  last_health_at?: string;
  last_watchdog_at?: string;
  last_bridge_pump_at?: string;
  last_decision_dedupe_at?: string;
};
