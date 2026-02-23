import { createHash, randomUUID } from "node:crypto";
import type {
  AppendDecisionInput,
  AppendDecisionResult,
  DecisionRecord,
  EffectiveDecisionContext,
  ListDecisionsFilter,
} from "./types.js";
import { DecisionStore } from "./store.js";
import { now_iso } from "../utils/common.js";

function normalize_space(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize_key(value: string): string {
  return normalize_space(value).toLowerCase().replace(/[\s\-]+/g, "_");
}

function normalize_value(value: string): string {
  return normalize_space(value).toLowerCase();
}

function fingerprint_of(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex");
}

function token_set(value: string): Set<string> {
  return new Set(
    normalize_value(value)
      .split(/[^a-z0-9가-힣]+/i)
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function similarity(a: string, b: string): number {
  const sa = token_set(a);
  const sb = token_set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

export class DecisionService {
  readonly store: DecisionStore;

  constructor(root = process.cwd(), decisions_dir_override?: string) {
    this.store = new DecisionStore(root, decisions_dir_override);
  }

  async append_decision(input: AppendDecisionInput): Promise<AppendDecisionResult> {
    return this.store.transaction(async ({ index, append, key_ref }) => {
      const now = now_iso();
      const canonical_key = normalize_key(input.key);
      const normalized_value = normalize_value(input.value);
      const scope_id = input.scope_id || null;
      const keyRef = key_ref(input.scope, scope_id, canonical_key);
      const fp = fingerprint_of([input.scope, scope_id || "", canonical_key, normalized_value]);

      const sameFingerprintId = index.fingerprints[fp];
      if (sameFingerprintId) {
        const sameFingerprint = index.records[sameFingerprintId];
        if (sameFingerprint && sameFingerprint.status === "active") {
          return { action: "deduped", record: sameFingerprint };
        }
      }

      const activeId = index.active_by_key[keyRef];
      if (activeId) {
        const active = index.records[activeId];
        if (active && active.status === "active") {
          if (
            active.normalized_value === normalized_value ||
            similarity(active.normalized_value, normalized_value) >= 0.92
          ) {
            active.updated_at = now;
            index.records[active.id] = active;
            append(active);
            return { action: "deduped", record: active };
          }
          active.status = "superseded";
          active.updated_at = now;
          index.records[active.id] = active;
          append(active);
        }
      }

      const record: DecisionRecord = {
        id: randomUUID().slice(0, 12),
        scope: input.scope,
        scope_id,
        key: input.key,
        canonical_key,
        value: normalize_space(input.value),
        normalized_value,
        rationale: input.rationale ? normalize_space(input.rationale) : null,
        priority: input.priority ?? 1,
        status: "active",
        source: input.source ?? "system",
        tags: Array.isArray(input.tags) ? input.tags.map((v) => normalize_space(v)).filter(Boolean) : [],
        supersedes_id: activeId || null,
        fingerprint: fp,
        created_at: now,
        updated_at: now,
      };
      index.records[record.id] = record;
      index.active_by_key[keyRef] = record.id;
      index.fingerprints[fp] = record.id;
      append(record);
      return {
        action: "inserted",
        record,
        superseded_id: activeId || undefined,
      };
    });
  }

  async list_decisions(filter?: ListDecisionsFilter): Promise<DecisionRecord[]> {
    const rows = await this.store.list_records();
    const limit = Math.max(1, Number(filter?.limit || 200));
    const key = filter?.key ? normalize_key(filter.key) : "";
    const search = filter?.search ? normalize_value(filter.search) : "";
    const scoped = rows.filter((r) => {
      if (filter?.scope && r.scope !== filter.scope) return false;
      if (filter?.scope_id !== undefined && (r.scope_id || null) !== (filter.scope_id || null)) return false;
      if (filter?.status && r.status !== filter.status) return false;
      if (key && r.canonical_key !== key) return false;
      if (typeof filter?.priority_lte === "number" && r.priority > filter.priority_lte) return false;
      if (search) {
        const hay = normalize_value(`${r.key} ${r.value} ${r.rationale || ""} ${r.tags.join(" ")}`);
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    return scoped
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, limit);
  }

  async get_effective_decisions(context?: EffectiveDecisionContext): Promise<DecisionRecord[]> {
    const rows = await this.list_decisions({ status: "active", limit: 2000 });
    const p1_limit = Math.max(1, Number(context?.p1_limit || 5));
    const p2_limit = Math.max(1, Number(context?.p2_limit || 3));

    const byCanonical = new Map<string, DecisionRecord>();
    const levels: Array<{ scope: "global" | "team" | "agent"; scope_id?: string | null }> = [
      { scope: "global", scope_id: null },
      { scope: "team", scope_id: context?.team_id || null },
      { scope: "agent", scope_id: context?.agent_id || null },
    ];
    for (const level of levels) {
      const scoped = rows
        .filter((r) => r.scope === level.scope && (r.scope_id || null) === (level.scope_id || null))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      for (const r of scoped) byCanonical.set(r.canonical_key, r);
    }

    const merged = [...byCanonical.values()];
    const p0 = merged.filter((r) => r.priority === 0);
    const p1 = merged.filter((r) => r.priority === 1).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, p1_limit);
    const p2 = context?.include_p2
      ? merged.filter((r) => r.priority === 2).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, p2_limit)
      : [];
    return [...p0, ...p1, ...p2];
  }

  async build_compact_injection(context?: EffectiveDecisionContext): Promise<string> {
    const rows = await this.get_effective_decisions(context);
    if (rows.length === 0) return "";
    const lines = rows.map((r) => `- [P${r.priority}] ${r.canonical_key}: ${r.value}`);
    return ["# DECISIONS_COMPACT", ...lines].join("\n");
  }

  async dedupe_decisions(): Promise<{ removed: number; active: number }> {
    return this.store.transaction(async ({ index, append, key_ref, rebuild_maps }) => {
      let changed = 0;
      const grouped = new Map<string, DecisionRecord[]>();
      for (const record of Object.values(index.records)) {
        if (record.status !== "active") continue;
        const ref = key_ref(record.scope, record.scope_id, record.canonical_key);
        const prev = grouped.get(ref) || [];
        prev.push(record);
        grouped.set(ref, prev);
      }
      for (const records of grouped.values()) {
        if (records.length <= 1) continue;
        const sorted = records.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        const keep = sorted[0];
        for (let i = 1; i < sorted.length; i += 1) {
          const rec = sorted[i];
          if (rec.status !== "active") continue;
          rec.status = "superseded";
          rec.supersedes_id = keep.id;
          rec.updated_at = now_iso();
          index.records[rec.id] = rec;
          append(rec);
          changed += 1;
        }
      }
      rebuild_maps();
      const active = Object.values(index.records).filter((r) => r.status === "active").length;
      return { removed: changed, active };
    });
  }
}
