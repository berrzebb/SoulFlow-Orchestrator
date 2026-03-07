/** Dashboard OAuth ops. */

import { create_logger } from "../../logger.js";
import { get_preset as get_oauth_preset, list_presets as list_oauth_presets } from "../../oauth/presets.js";
import type { DashboardOAuthOps, OAuthIntegrationInfo } from "../service.js";
import type { OAuthIntegrationStore } from "../../oauth/integration-store.js";
import type { OAuthFlowService } from "../../oauth/flow-service.js";

export function create_oauth_ops(deps: {
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  dashboard_port: number;
  public_url?: string;
}): DashboardOAuthOps {
  const { oauth_store, oauth_flow, dashboard_port, public_url } = deps;
  const log = create_logger("oauth-ops");

  function resolve_origin(request_origin: string | undefined): string {
    if (public_url) return public_url.replace(/\/$/, "");
    return request_origin ?? `http://localhost:${dashboard_port}`;
  }

  async function build_info(config: import("../../oauth/integration-store.js").OAuthIntegrationConfig): Promise<OAuthIntegrationInfo> {
    const has_token = await oauth_store.has_access_token(config.instance_id);
    const has_secret = await oauth_store.has_client_secret(config.instance_id);
    return {
      instance_id: config.instance_id, service_type: config.service_type,
      label: config.label, enabled: config.enabled, scopes: config.scopes,
      token_configured: has_token, expired: oauth_store.is_expired(config.instance_id),
      expires_at: config.expires_at, has_client_secret: has_secret,
      created_at: config.created_at, updated_at: config.updated_at,
    };
  }

  return {
    async list() { return Promise.all(oauth_store.list().map(build_info)); },
    async get(id) { const c = oauth_store.get(id); return c ? build_info(c) : null; },

    async create(input) {
      if (!input.service_type || !input.client_id) return { ok: false, error: "service_type_and_client_id_required" };
      const instance_id = input.label?.toLowerCase().replace(/\s+/g, "-") || input.service_type;
      if (oauth_store.get(instance_id)) return { ok: false, error: "instance_already_exists" };
      const preset = get_oauth_preset(input.service_type);
      const auth_url = input.auth_url || preset?.auth_url || "";
      const token_url = input.token_url || preset?.token_url || "";
      const redirect_uri = `${resolve_origin(undefined)}/api/oauth/callback`;
      oauth_store.upsert({
        instance_id, service_type: input.service_type,
        label: input.label || instance_id, enabled: true,
        scopes: input.scopes || preset?.default_scopes || [],
        auth_url, token_url, redirect_uri, settings: {},
      });
      await oauth_store.vault_store_client_id(instance_id, input.client_id);
      if (input.client_secret) await oauth_store.vault_store_client_secret(instance_id, input.client_secret);
      log.info("oauth_integration_create", { id: instance_id, service_type: input.service_type });
      return { ok: true, instance_id };
    },

    async update(id, patch) {
      if (!oauth_store.get(id)) return { ok: false, error: "not_found" };
      oauth_store.update_settings(id, patch);
      log.info("oauth_integration_update", { id, fields: Object.keys(patch) });
      return { ok: true };
    },

    async remove(id) {
      const existed = oauth_store.remove(id);
      if (!existed) return { ok: false, error: "not_found" };
      await oauth_store.remove_tokens(id);
      log.info("oauth_integration_remove", { id });
      return { ok: true };
    },

    async start_auth(id, client_secret, origin) {
      const integration = oauth_store.get(id);
      if (!integration) return { ok: false, error: "not_found" };
      const client_id = await oauth_store.get_client_id(id);
      if (!client_id) return { ok: false, error: "missing_client_id" };
      if (client_secret) await oauth_store.vault_store_client_secret(id, client_secret);
      const effective_origin = resolve_origin(origin);
      const redirect_uri = `${effective_origin}/api/oauth/callback`;
      if (integration.redirect_uri !== redirect_uri) oauth_store.upsert({ ...integration, redirect_uri });
      const updated = oauth_store.get(id) ?? integration;
      const auth_url = oauth_flow.generate_auth_url_with_client_id(updated, client_id);
      return { ok: true, auth_url };
    },

    async refresh(id) { return oauth_flow.refresh_token(id); },
    async test(id) { return oauth_flow.test_token(id); },
    list_presets() { return list_oauth_presets(); },

    async register_preset(preset) {
      if (!preset.service_type || !preset.auth_url || !preset.token_url) return { ok: false, error: "service_type, auth_url, token_url required" };
      oauth_flow.register_custom_preset({ scopes_available: [], default_scopes: [], supports_refresh: true, ...preset });
      return { ok: true };
    },

    async update_preset(service_type, patch) {
      const existing = get_oauth_preset(service_type);
      if (!existing) return { ok: false, error: "preset_not_found" };
      oauth_flow.register_custom_preset({ ...existing, ...patch });
      return { ok: true };
    },

    async unregister_preset(service_type) {
      const removed = oauth_flow.unregister_custom_preset(service_type);
      return removed ? { ok: true } : { ok: false, error: "preset_not_found_in_db" };
    },
  };
}
