/** FeatureFlag 도구 — 피처 플래그 정의/평가/롤아웃/세그먼트 분기. */

import { createHash } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface FlagDef {
  name: string;
  enabled: boolean;
  rollout_pct: number;
  segments: string[];
  overrides: Map<string, boolean>;
  created_at: number;
  eval_count: number;
  true_count: number;
}

const flags = new Map<string, FlagDef>();

function hash_pct(flag: string, user: string): number {
  const h = createHash("md5").update(`${flag}:${user}`).digest();
  return (h.readUInt32BE(0) % 10000) / 100;
}

export class FeatureFlagTool extends Tool {
  readonly name = "feature_flag";
  readonly category = "data" as const;
  readonly description = "Feature flags: define, evaluate, rollout, user_segment, override, list, stats.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["define", "evaluate", "rollout", "user_segment", "override", "list", "stats"], description: "Operation" },
      name: { type: "string", description: "Flag name" },
      enabled: { type: "boolean", description: "Flag enabled state" },
      rollout_pct: { type: "number", description: "Rollout percentage (0-100)" },
      user_id: { type: "string", description: "User identifier for evaluation" },
      segments: { type: "string", description: "JSON array of segment names" },
      user_segments: { type: "string", description: "JSON array of user's segment memberships" },
      value: { type: "boolean", description: "Override value" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "list");
    const name = String(params.name || "");

    switch (action) {
      case "define": {
        if (!name) return JSON.stringify({ error: "name is required" });
        let segments: string[] = [];
        try { segments = params.segments ? JSON.parse(String(params.segments)) : []; } catch { segments = []; }
        const def: FlagDef = {
          name,
          enabled: params.enabled !== false,
          rollout_pct: Math.min(100, Math.max(0, Number(params.rollout_pct ?? 100))),
          segments,
          overrides: new Map(),
          created_at: Date.now(),
          eval_count: 0,
          true_count: 0,
        };
        flags.set(name, def);
        return JSON.stringify({ defined: name, enabled: def.enabled, rollout_pct: def.rollout_pct, segments: def.segments });
      }
      case "evaluate": {
        const flag = flags.get(name);
        if (!flag) return JSON.stringify({ error: `flag '${name}' not found` });
        const user_id = String(params.user_id || "anonymous");
        flag.eval_count++;

        if (flag.overrides.has(user_id)) {
          const v = flag.overrides.get(user_id)!;
          if (v) flag.true_count++;
          return JSON.stringify({ flag: name, user: user_id, result: v, reason: "override" });
        }
        if (!flag.enabled) {
          return JSON.stringify({ flag: name, user: user_id, result: false, reason: "disabled" });
        }
        if (flag.segments.length > 0) {
          let user_segs: string[] = [];
          try { user_segs = params.user_segments ? JSON.parse(String(params.user_segments)) : []; } catch { user_segs = []; }
          const match = flag.segments.some((s) => user_segs.includes(s));
          if (!match) {
            return JSON.stringify({ flag: name, user: user_id, result: false, reason: "segment_mismatch" });
          }
        }
        const pct = hash_pct(name, user_id);
        const result = pct < flag.rollout_pct;
        if (result) flag.true_count++;
        return JSON.stringify({ flag: name, user: user_id, result, reason: "rollout", hash_pct: Math.round(pct * 100) / 100 });
      }
      case "rollout": {
        const flag = flags.get(name);
        if (!flag) return JSON.stringify({ error: `flag '${name}' not found` });
        const pct = Math.min(100, Math.max(0, Number(params.rollout_pct ?? flag.rollout_pct)));
        flag.rollout_pct = pct;
        return JSON.stringify({ flag: name, rollout_pct: pct });
      }
      case "user_segment": {
        const flag = flags.get(name);
        if (!flag) return JSON.stringify({ error: `flag '${name}' not found` });
        let segments: string[] = [];
        try { segments = params.segments ? JSON.parse(String(params.segments)) : []; } catch { segments = []; }
        flag.segments = segments;
        return JSON.stringify({ flag: name, segments });
      }
      case "override": {
        const flag = flags.get(name);
        if (!flag) return JSON.stringify({ error: `flag '${name}' not found` });
        const user_id = String(params.user_id || "");
        if (!user_id) return JSON.stringify({ error: "user_id is required" });
        const value = params.value === true;
        flag.overrides.set(user_id, value);
        return JSON.stringify({ flag: name, user: user_id, override: value });
      }
      case "list": {
        const result = [...flags.values()].map((f) => ({
          name: f.name, enabled: f.enabled, rollout_pct: f.rollout_pct,
          segments: f.segments, overrides_count: f.overrides.size,
        }));
        return JSON.stringify({ flags: result, count: result.length });
      }
      case "stats": {
        const flag = flags.get(name);
        if (!flag) return JSON.stringify({ error: `flag '${name}' not found` });
        return JSON.stringify({
          flag: name, eval_count: flag.eval_count, true_count: flag.true_count,
          true_rate: flag.eval_count > 0 ? Math.round((flag.true_count / flag.eval_count) * 10000) / 100 : 0,
          overrides_count: flag.overrides.size, created_at: new Date(flag.created_at).toISOString(),
        });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
