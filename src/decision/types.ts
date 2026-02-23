export type DecisionScope = "global" | "team" | "agent";
export type DecisionStatus = "active" | "superseded" | "archived";
export type DecisionPriority = 0 | 1 | 2 | 3;
export type DecisionSource = "user" | "leader" | "system" | "agent";

export type DecisionRecord = {
  id: string;
  scope: DecisionScope;
  scope_id?: string | null;
  key: string;
  canonical_key: string;
  value: string;
  normalized_value: string;
  rationale?: string | null;
  priority: DecisionPriority;
  status: DecisionStatus;
  source: DecisionSource;
  tags: string[];
  supersedes_id?: string | null;
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

export type DecisionIndexData = {
  version: number;
  records: Record<string, DecisionRecord>;
  active_by_key: Record<string, string>;
  fingerprints: Record<string, string>;
  updated_at: string;
};

export type AppendDecisionInput = {
  scope: DecisionScope;
  scope_id?: string | null;
  key: string;
  value: string;
  rationale?: string | null;
  priority?: DecisionPriority;
  source?: DecisionSource;
  tags?: string[];
};

export type AppendDecisionResult = {
  action: "inserted" | "deduped";
  record: DecisionRecord;
  superseded_id?: string;
};

export type ListDecisionsFilter = {
  scope?: DecisionScope;
  scope_id?: string | null;
  status?: DecisionStatus;
  key?: string;
  priority_lte?: number;
  limit?: number;
  search?: string;
};

export type EffectiveDecisionContext = {
  team_id?: string | null;
  agent_id?: string | null;
  include_p2?: boolean;
  p1_limit?: number;
  p2_limit?: number;
};
