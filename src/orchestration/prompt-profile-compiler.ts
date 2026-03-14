/**
 * RP-3: PromptProfileCompiler.
 *
 * RolePolicy + ResolvedProtocol → PromptProfile 합성.
 * compiler는 role policy source를 직접 소유하지 않는다 — resolver 의존성을 받는다.
 */

import type { RolePolicy, RolePolicyResolverLike } from "./role-policy-resolver.js";
import type { ResolvedProtocol, ProtocolResolverLike } from "./protocol-resolver.js";

/** 컴파일된 역할 프로필. */
export interface PromptProfile {
  readonly role_id: string;
  readonly soul: string;
  readonly heart: string;
  readonly tools: readonly string[];
  readonly preferred_model: string | null;
  readonly use_when: string;
  readonly not_use_for: string;
  readonly protocol_sections: readonly ResolvedProtocol[];
  readonly execution_protocol: string | null;
  readonly checklist: string | null;
  readonly error_playbook: string | null;
}

/** PromptProfileCompiler 계약. */
export interface PromptProfileCompilerLike {
  compile(role_id: string): PromptProfile | null;
  render_system_section(profile: PromptProfile): string;
}

/** PromptProfileCompiler 생성. */
export function create_prompt_profile_compiler(
  policy_resolver: RolePolicyResolverLike,
  protocol_resolver: ProtocolResolverLike,
): PromptProfileCompilerLike {
  return {
    compile(role_id: string): PromptProfile | null {
      const policy = policy_resolver.resolve(role_id);
      if (!policy) return null;
      const protocols = protocol_resolver.resolve(policy.shared_protocols);
      return build_profile(policy, protocols);
    },

    render_system_section(profile: PromptProfile): string {
      return render_profile_sections(profile);
    },
  };
}

/** RolePolicy + ResolvedProtocol[] → PromptProfile. */
function build_profile(
  policy: RolePolicy,
  protocols: readonly ResolvedProtocol[],
): PromptProfile {
  return {
    role_id: policy.role_id,
    soul: policy.soul,
    heart: policy.heart,
    tools: policy.tools,
    preferred_model: policy.preferred_model,
    use_when: policy.use_when,
    not_use_for: policy.not_use_for,
    protocol_sections: protocols,
    execution_protocol: policy.execution_protocol,
    checklist: policy.checklist,
    error_playbook: policy.error_playbook,
  };
}

/** PromptProfile → system prompt 섹션 렌더링. */
function render_profile_sections(profile: PromptProfile): string {
  const sections: string[] = [];

  sections.push(`# Role: ${profile.role_id}`);
  if (profile.soul) sections.push(`Soul: ${profile.soul}`);
  if (profile.heart) sections.push(`Heart: ${profile.heart}`);

  for (const proto of profile.protocol_sections) {
    sections.push(`## Protocol: ${proto.name}\n${proto.content}`);
  }

  if (profile.execution_protocol) {
    sections.push(`## Execution Protocol\n${profile.execution_protocol}`);
  }
  if (profile.checklist) {
    sections.push(`## Checklist\n${profile.checklist}`);
  }
  if (profile.error_playbook) {
    sections.push(`## Error Playbook\n${profile.error_playbook}`);
  }

  return sections.join("\n\n");
}
