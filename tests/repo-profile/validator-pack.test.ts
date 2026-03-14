import { describe, it, expect } from "vitest";
import { create_validator_pack, resolve_validator, has_validator } from "@src/repo-profile/validator-pack.ts";
import type { RepoProfile } from "@src/repo-profile/repo-profile.ts";

const base_profile: RepoProfile = {
  repo_id: "test-repo",
  capabilities: [],
  commands: {},
  protected_paths: [],
};

// ── create_validator_pack ─────────────────────────────────────────────────────

describe("create_validator_pack", () => {
  it("capabilities 없으면 validators가 빈 배열", () => {
    const pack = create_validator_pack(base_profile);
    expect(pack.validators).toHaveLength(0);
    expect(pack.repo_id).toBe("test-repo");
  });

  it("commands에 있는 capability는 해당 명령을 사용", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["lint"],
      commands: { lint: "npm run lint" },
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(1);
    expect(pack.validators[0]).toEqual({ kind: "lint", command: "npm run lint" });
  });

  it("commands에 없는 capability는 FALLBACK 명령 사용", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["lint", "typecheck", "test"],
      commands: {},
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(3);
    expect(pack.validators.find((v) => v.kind === "lint")?.command).toBe("npx eslint src/");
    expect(pack.validators.find((v) => v.kind === "typecheck")?.command).toBe("npx tsc --noEmit");
    expect(pack.validators.find((v) => v.kind === "test")?.command).toBe("npx vitest run");
  });

  it("eval은 fallback 없으므로 commands 없으면 pack에서 제외", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["eval"],
      commands: {},
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(0);
  });

  it("eval에 commands가 있으면 포함", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["eval"],
      commands: { eval: "npx tsx scripts/eval-run.ts" },
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(1);
    expect(pack.validators[0]).toEqual({ kind: "eval", command: "npx tsx scripts/eval-run.ts" });
  });

  it("capabilities에 없는 kind는 commands에 있어도 포함 안 됨", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["test"],
      commands: { lint: "npm run lint", test: "npm test" },
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(1);
    expect(pack.validators[0].kind).toBe("test");
  });

  it("전체 capabilities + commands 조합 — 4개 모두 포함", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["lint", "typecheck", "test", "eval"],
      commands: {
        lint: "npm run lint",
        typecheck: "tsc",
        test: "vitest run",
        eval: "tsx eval.ts",
      },
    };
    const pack = create_validator_pack(profile);
    expect(pack.validators).toHaveLength(4);
  });

  it("validators 순서: lint → typecheck → test → eval", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["eval", "test", "lint", "typecheck"],
      commands: { eval: "tsx eval.ts" },
    };
    const pack = create_validator_pack(profile);
    const kinds = pack.validators.map((v) => v.kind);
    expect(kinds).toEqual(["lint", "typecheck", "test", "eval"]);
  });
});

// ── resolve_validator ─────────────────────────────────────────────────────────

describe("resolve_validator", () => {
  it("존재하는 kind는 ValidatorCommand 반환", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["lint"],
      commands: { lint: "npm run lint" },
    };
    const pack = create_validator_pack(profile);
    const result = resolve_validator(pack, "lint");
    expect(result).toEqual({ kind: "lint", command: "npm run lint" });
  });

  it("존재하지 않는 kind는 null 반환", () => {
    const pack = create_validator_pack(base_profile);
    expect(resolve_validator(pack, "lint")).toBeNull();
  });
});

// ── has_validator ─────────────────────────────────────────────────────────────

describe("has_validator", () => {
  it("포함된 kind는 true", () => {
    const profile: RepoProfile = {
      ...base_profile,
      capabilities: ["test"],
      commands: {},
    };
    const pack = create_validator_pack(profile);
    expect(has_validator(pack, "test")).toBe(true);
  });

  it("포함되지 않은 kind는 false", () => {
    const pack = create_validator_pack(base_profile);
    expect(has_validator(pack, "lint")).toBe(false);
  });
});
