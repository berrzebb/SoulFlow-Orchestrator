/**
 * RP-1: RolePolicyResolver.
 *
 * role asset(SKILL.md) 로드 + RolePolicy 정규화.
 * resolver는 정책을 읽어 구조화만 한다 — 새 정책 값을 만들어내면 안 된다.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SkillMetadata } from "../agent/skills.types.js";

/** role skill에서 정규화된 정책 구조. */
export interface RolePolicy {
  readonly role_id: string;
  readonly soul: string;
  readonly heart: string;
  readonly tools: readonly string[];
  readonly shared_protocols: readonly string[];
  readonly preferred_model: string | null;
  readonly use_when: string;
  readonly not_use_for: string;
  readonly execution_protocol: string | null;
  readonly checklist: string | null;
  readonly error_playbook: string | null;
}

/** RolePolicyResolver 계약. */
export interface RolePolicyResolverLike {
  resolve(role_id: string): RolePolicy | null;
  list_roles(): readonly string[];
}

/** SkillsLoader 최소 계약 — RolePolicyResolver가 의존하는 부분만. */
export interface RolePolicySkillSource {
  get_role_skill(role: string): SkillMetadata | null;
  list_role_skills(): SkillMetadata[];
}

/** SKILL.md description에서 use_when/not_use_for 추출. */
function parse_description(desc: string): { use_when: string; not_use_for: string } {
  const use_match = desc.match(/Use when\s+(.+?)(?:\.|$)/i);
  const not_match = desc.match(/Do NOT use for\s+(.+?)(?:\.|$)/i);
  return {
    use_when: use_match ? use_match[1].trim() : "",
    not_use_for: not_match ? not_match[1].trim() : "",
  };
}

/** resources/ 하위 파일 로드. 없으면 null. */
function load_resource(skill_path: string, filename: string): string | null {
  const resources_dir = join(dirname(skill_path), "resources");
  const file = join(resources_dir, filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8").trim() || null;
}

/** SkillMetadata → RolePolicy 정규화. */
function normalize_role_policy(meta: SkillMetadata): RolePolicy {
  const { use_when, not_use_for } = parse_description(meta.summary);
  return {
    role_id: meta.role || meta.name,
    soul: meta.soul || "",
    heart: meta.heart || "",
    tools: meta.tools,
    shared_protocols: meta.shared_protocols,
    preferred_model: meta.model,
    use_when,
    not_use_for,
    execution_protocol: load_resource(meta.path, "execution-protocol.md"),
    checklist: load_resource(meta.path, "checklist.md"),
    error_playbook: load_resource(meta.path, "error-playbook.md"),
  };
}

/** RolePolicyResolver 생성. */
export function create_role_policy_resolver(source: RolePolicySkillSource): RolePolicyResolverLike {
  return {
    resolve(role_id: string): RolePolicy | null {
      const meta = source.get_role_skill(role_id);
      if (!meta) return null;
      return normalize_role_policy(meta);
    },
    list_roles(): readonly string[] {
      return source.list_role_skills()
        .map(m => m.role)
        .filter((r): r is string => r !== null);
    },
  };
}
