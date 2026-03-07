/** Dashboard channel ops. */

import { error_message } from "../../utils/common.js";
import { create_logger } from "../../logger.js";
import { create_channel_instance, type ChannelRegistryLike } from "../../channels/index.js";
import type { DashboardChannelOps, ChannelStatusInfo } from "../service.js";
import type { ChannelInstanceStore } from "../../channels/instance-store.js";
import type { AppConfig } from "../../config/schema.js";

const CHANNEL_TEST_URLS: Record<string, (token: string, api_base?: string) => { url: string; headers: Record<string, string> }> = {
  slack: (token) => ({ url: "https://slack.com/api/auth.test", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  discord: (token, api_base) => ({ url: `${api_base || "https://discord.com/api/v10"}/users/@me`, headers: { Authorization: `Bot ${token}` } }),
  telegram: (token, api_base) => ({ url: `${api_base || "https://api.telegram.org"}/bot${token}/getMe`, headers: {} }),
};

export function create_channel_ops(deps: {
  channels: ChannelRegistryLike;
  instance_store: ChannelInstanceStore;
  app_config: AppConfig;
}): DashboardChannelOps {
  const { channels, instance_store } = deps;
  const log = create_logger("channel-ops");

  function build_status(
    config: import("../../channels/instance-store.js").ChannelInstanceConfig,
    health: import("../../channels/types.js").ChannelHealth | null,
    has_token: boolean,
  ): ChannelStatusInfo {
    const settings = config.settings as Record<string, unknown>;
    const default_target = String(settings.default_channel || settings.default_chat_id || "");
    return {
      provider: config.provider,
      instance_id: config.instance_id,
      label: config.label,
      enabled: config.enabled,
      running: health?.running ?? false,
      healthy: health?.running ?? false,
      last_error: health?.last_error,
      token_configured: has_token,
      default_target,
      settings: config.settings,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  return {
    async list(): Promise<ChannelStatusInfo[]> {
      const instances = instance_store.list();
      const health_list = channels.get_health();
      const health_map = new Map(health_list.map((h) => [h.instance_id, h]));
      const results: ChannelStatusInfo[] = [];
      for (const config of instances) {
        const has_token = await instance_store.has_token(config.instance_id);
        results.push(build_status(config, health_map.get(config.instance_id) ?? null, has_token));
      }
      return results;
    },

    async get(instance_id: string): Promise<ChannelStatusInfo | null> {
      const config = instance_store.get(instance_id);
      if (!config) return null;
      const health = channels.get_health().find((h) => h.instance_id === instance_id) ?? null;
      const has_token = await instance_store.has_token(instance_id);
      return build_status(config, health, has_token);
    },

    async create(input): Promise<{ ok: boolean; error?: string }> {
      if (!input.instance_id || !input.provider) return { ok: false, error: "instance_id_and_provider_required" };
      if (instance_store.get(input.instance_id)) return { ok: false, error: "instance_already_exists" };
      const config = {
        instance_id: input.instance_id,
        provider: input.provider,
        label: input.label || input.instance_id,
        enabled: input.enabled ?? true,
        settings: input.settings || {},
      };
      instance_store.upsert(config);
      if (input.token) {
        await instance_store.set_token(input.instance_id, input.token);
      }
      const saved = instance_store.get(input.instance_id);
      if (saved?.enabled) {
        const token = await instance_store.get_token(saved.instance_id) || "";
        const ch = create_channel_instance(saved, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel created and started", { instance_id: saved.instance_id, provider: saved.provider });
          } catch (err) {
            log.warn("channel created but start failed", { instance_id: saved.instance_id, error: error_message(err) });
          }
        }
      }
      return { ok: true };
    },

    async update(instance_id, patch): Promise<{ ok: boolean; error?: string }> {
      const existing = instance_store.get(instance_id);
      if (!existing) return { ok: false, error: "not_found" };
      instance_store.update_settings(instance_id, {
        label: patch.label,
        enabled: patch.enabled,
        settings: patch.settings,
      });
      if (patch.token !== undefined) {
        if (patch.token) {
          await instance_store.set_token(instance_id, patch.token);
        } else {
          await instance_store.remove_token(instance_id);
        }
      }
      const old = channels.get_channel(instance_id);
      if (old?.is_running()) {
        try { await old.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      const updated = instance_store.get(instance_id);
      if (updated?.enabled) {
        const token = await instance_store.get_token(instance_id) || "";
        const ch = create_channel_instance(updated, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel hot-swapped", { instance_id, provider: updated.provider });
          } catch (err) {
            log.warn("channel hot-swap start failed", { instance_id, error: error_message(err) });
          }
        }
      } else {
        log.info("channel stopped (disabled)", { instance_id });
      }
      return { ok: true };
    },

    async remove(instance_id): Promise<{ ok: boolean; error?: string }> {
      const ch = channels.get_channel(instance_id);
      if (ch?.is_running()) {
        try { await ch.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      await instance_store.remove_token(instance_id);
      const removed = instance_store.remove(instance_id);
      if (removed) log.info("channel removed", { instance_id });
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_connection(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
      const config = instance_store.get(instance_id);
      if (!config) return { ok: false, error: "instance_not_found" };
      const token = await instance_store.get_token(instance_id) || "";
      if (!token) return { ok: false, error: "token_not_configured" };
      const builder = CHANNEL_TEST_URLS[config.provider];
      if (!builder) return { ok: false, error: "unsupported_provider" };
      const api_base = String((config.settings as Record<string, unknown>).api_base || "");
      const { url, headers } = builder(token, api_base || undefined);
      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
        if (!resp.ok) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, status: resp.status });
          return { ok: false, error: `HTTP ${resp.status}`, detail: JSON.stringify(body).slice(0, 200) };
        }
        if (config.provider === "slack" && body?.ok === false) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, error: String(body.error || "slack_auth_failed") });
          return { ok: false, error: String(body.error || "slack_auth_failed") };
        }
        const detail = config.provider === "slack"
          ? String(body?.team || "")
          : config.provider === "discord"
            ? String((body as Record<string, unknown>)?.username || "")
            : String((body as { result?: { username?: string } })?.result?.username || "");
        log.info("channel test_connection ok", { instance_id, provider: config.provider });
        return { ok: true, detail };
      } catch (e) {
        log.warn("channel test_connection error", { instance_id, provider: config.provider, error: error_message(e) });
        return { ok: false, error: error_message(e) };
      }
    },

    list_providers(): string[] {
      return [...new Set(instance_store.list().map((c) => c.provider))];
    },
  };
}
