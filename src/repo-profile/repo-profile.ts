/**
 * RPF-1: RepoProfile Contract — 저장소별 실행 메타데이터를 하나의 profile로 표현.
 */

export type RepoCapability = "lint" | "test" | "eval" | "typecheck";

export interface RepoCommandSet {
  lint?: string;
  test?: string;
  eval?: string;
  typecheck?: string;
}

export interface RepoProfile {
  repo_id: string;
  capabilities: RepoCapability[];
  commands: RepoCommandSet;
  /** 보호 경로 — glob 또는 prefix. 이 경로 변경은 자동으로 critical 등급. */
  protected_paths: string[];
}

export const DEFAULT_REPO_PROFILE: RepoProfile = {
  repo_id: "default",
  capabilities: [],
  commands: {},
  protected_paths: [],
};

/** 빈 profile을 repo_id로 생성. */
export function create_default_profile(repo_id: string): RepoProfile {
  return { repo_id, capabilities: [], commands: {}, protected_paths: [] };
}

const VALID_CAPABILITIES = new Set<string>(["lint", "test", "eval", "typecheck"]);

/**
 * 외부 소스(JSON 파일, API 응답 등)에서 RepoProfile을 파싱.
 * repo_id 없으면 throw, 알 수 없는 capability/비문자열 항목은 필터링.
 */
export function load_repo_profile(source: unknown): RepoProfile {
  if (typeof source !== "object" || source === null) {
    throw new TypeError("RepoProfile source must be a non-null object");
  }

  const raw = source as Record<string, unknown>;

  if (typeof raw["repo_id"] !== "string" || !raw["repo_id"]) {
    throw new TypeError("RepoProfile.repo_id is required and must be a non-empty string");
  }

  const capabilities: RepoCapability[] = Array.isArray(raw["capabilities"])
    ? (raw["capabilities"] as unknown[]).filter(
        (c): c is RepoCapability => typeof c === "string" && VALID_CAPABILITIES.has(c),
      )
    : [];

  const raw_commands =
    typeof raw["commands"] === "object" && raw["commands"] !== null
      ? (raw["commands"] as Record<string, unknown>)
      : {};

  const commands: RepoCommandSet = {};
  for (const key of ["lint", "test", "eval", "typecheck"] as const) {
    if (typeof raw_commands[key] === "string") {
      commands[key] = raw_commands[key] as string;
    }
  }

  const protected_paths: string[] = Array.isArray(raw["protected_paths"])
    ? (raw["protected_paths"] as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  return { repo_id: raw["repo_id"], capabilities, commands, protected_paths };
}
