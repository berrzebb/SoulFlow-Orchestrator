/** Dashboard config ops. */

import { SECTION_ORDER, SECTION_LABELS, type ConfigSection } from "../../config/config-meta.js";
import { get_config_defaults, set_nested } from "../../config/schema.js";
import type { DashboardConfigOps } from "../service.js";
import type { ConfigStore } from "../../config/config-store.js";
import type { AppConfig } from "../../config/schema.js";

export function create_config_ops(deps: {
  app_config: AppConfig;
  config_store: ConfigStore;
}): DashboardConfigOps {
  const { app_config, config_store } = deps;
  return {
    get_current_config: () => app_config as unknown as Record<string, unknown>,
    get_sections: async () => {
      const config_raw = app_config as unknown as Record<string, unknown>;
      const results = [];
      for (const id of SECTION_ORDER) {
        results.push({ id, label: SECTION_LABELS[id], fields: await config_store.get_section_status(id, config_raw) });
      }
      return results;
    },
    get_section: async (section: string) => {
      if (!SECTION_ORDER.includes(section as ConfigSection)) return null;
      const config_raw = app_config as unknown as Record<string, unknown>;
      return {
        id: section,
        label: SECTION_LABELS[section as ConfigSection],
        fields: await config_store.get_section_status(section as ConfigSection, config_raw),
      };
    },
    set_value: async (path: string, value: unknown) => {
      await config_store.set_value(path, value);
      set_nested(app_config as unknown as Record<string, unknown>, path, value);
    },
    remove_value: async (path: string) => {
      await config_store.remove_value(path);
      const fresh = get_config_defaults();
      const keys = path.split(".");
      let def: unknown = fresh as unknown as Record<string, unknown>;
      for (const k of keys) {
        if (def === null || def === undefined || typeof def !== "object") { def = undefined; break; }
        def = (def as Record<string, unknown>)[k];
      }
      set_nested(app_config as unknown as Record<string, unknown>, path, def);
    },
  };
}
