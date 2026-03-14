/**
 * RPF-4: ValidatorPack — repo별 lint/test/eval/typecheck 명령을 공통 실행 계약으로 표현.
 * RepoProfile의 capabilities + commands를 받아 실행 가능한 명령 목록으로 해석.
 * 실제 실행은 caller 책임 — ValidatorPack은 명령 명세(계약)만 담는다.
 */

import type { RepoCapability, RepoCommandSet, RepoProfile } from "./repo-profile.js";

export interface ValidatorCommand {
  kind: RepoCapability;
  command: string;
}

export interface ValidatorPack {
  readonly repo_id: string;
  readonly validators: readonly ValidatorCommand[];
}

/** capability가 선언되었지만 commands에 없을 때 사용하는 기본 명령. eval은 공통 기본값 없음. */
const FALLBACK_COMMANDS: Partial<RepoCommandSet> = {
  lint: "npx eslint src/",
  test: "npx vitest run",
  typecheck: "npx tsc --noEmit",
};

/**
 * RepoProfile에서 ValidatorPack을 생성.
 * capabilities에 없는 항목은 포함하지 않으며, commands에 없으면 FALLBACK_COMMANDS를 사용.
 * fallback도 없으면 해당 kind는 pack에서 제외.
 */
export function create_validator_pack(profile: RepoProfile): ValidatorPack {
  const validators: ValidatorCommand[] = [];
  const order: RepoCapability[] = ["lint", "typecheck", "test", "eval"];

  for (const kind of order) {
    if (!profile.capabilities.includes(kind)) continue;
    const command = profile.commands[kind] ?? FALLBACK_COMMANDS[kind];
    if (command) validators.push({ kind, command });
  }

  return { repo_id: profile.repo_id, validators };
}

/** pack에서 특정 kind의 ValidatorCommand를 반환. 없으면 null. */
export function resolve_validator(pack: ValidatorPack, kind: RepoCapability): ValidatorCommand | null {
  return pack.validators.find((v) => v.kind === kind) ?? null;
}

/** pack에 해당 kind가 포함되어 있는지 여부. */
export function has_validator(pack: ValidatorPack, kind: RepoCapability): boolean {
  return pack.validators.some((v) => v.kind === kind);
}
