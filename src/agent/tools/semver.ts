/** Semver 도구 — 시맨틱 버전 비교/범위 검사/bump. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
  build: string;
}

export class SemverTool extends Tool {
  readonly name = "semver";
  readonly category = "data" as const;
  readonly description = "Semantic version operations: parse, compare, satisfies, bump, sort, diff, valid.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "compare", "satisfies", "bump", "sort", "diff", "valid"], description: "Semver operation" },
      version: { type: "string", description: "Version string (e.g. '1.2.3')" },
      version2: { type: "string", description: "Second version (for compare/diff)" },
      range: { type: "string", description: "Version range (for satisfies, e.g. '>=1.0.0 <2.0.0')" },
      bump_type: { type: "string", enum: ["major", "minor", "patch", "prerelease"], description: "Bump type (for bump)" },
      versions: { type: "string", description: "Comma-separated versions (for sort)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const v = this.parse(String(params.version || ""));
        if (!v) return "Error: invalid version";
        return JSON.stringify(v);
      }
      case "compare": {
        const a = this.parse(String(params.version || ""));
        const b = this.parse(String(params.version2 || ""));
        if (!a || !b) return "Error: invalid version(s)";
        const cmp = this.compare_versions(a, b);
        return JSON.stringify({ result: cmp, description: cmp > 0 ? "greater" : cmp < 0 ? "less" : "equal" });
      }
      case "satisfies": {
        const v = this.parse(String(params.version || ""));
        const range = String(params.range || "");
        if (!v) return "Error: invalid version";
        return JSON.stringify({ satisfies: this.check_range(v, range), version: params.version, range });
      }
      case "bump": {
        const v = this.parse(String(params.version || ""));
        if (!v) return "Error: invalid version";
        const type = String(params.bump_type || "patch");
        const bumped = this.bump_version(v, type);
        return JSON.stringify({ original: params.version, bumped: this.to_string(bumped), type });
      }
      case "sort": {
        const list = String(params.versions || "").split(",").map((s) => s.trim()).filter(Boolean);
        const parsed = list.map((s) => ({ raw: s, semver: this.parse(s) })).filter((p) => p.semver);
        parsed.sort((a, b) => this.compare_versions(a.semver!, b.semver!));
        return JSON.stringify({ sorted: parsed.map((p) => p.raw), count: parsed.length });
      }
      case "diff": {
        const a = this.parse(String(params.version || ""));
        const b = this.parse(String(params.version2 || ""));
        if (!a || !b) return "Error: invalid version(s)";
        let diff = "none";
        if (a.major !== b.major) diff = "major";
        else if (a.minor !== b.minor) diff = "minor";
        else if (a.patch !== b.patch) diff = "patch";
        else if (a.prerelease !== b.prerelease) diff = "prerelease";
        return JSON.stringify({ diff, version: params.version, version2: params.version2 });
      }
      case "valid": {
        const v = this.parse(String(params.version || ""));
        return JSON.stringify({ valid: !!v, version: params.version, normalized: v ? this.to_string(v) : null });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse(s: string): SemVer | null {
    const clean = s.trim().replace(/^v/i, "");
    const m = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] || "", build: m[5] || "" };
  }

  private to_string(v: SemVer): string {
    let s = `${v.major}.${v.minor}.${v.patch}`;
    if (v.prerelease) s += `-${v.prerelease}`;
    if (v.build) s += `+${v.build}`;
    return s;
  }

  private compare_versions(a: SemVer, b: SemVer): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && !b.prerelease) return -1;
    return a.prerelease.localeCompare(b.prerelease);
  }

  private bump_version(v: SemVer, type: string): SemVer {
    switch (type) {
      case "major": return { major: v.major + 1, minor: 0, patch: 0, prerelease: "", build: "" };
      case "minor": return { major: v.major, minor: v.minor + 1, patch: 0, prerelease: "", build: "" };
      case "patch": return { major: v.major, minor: v.minor, patch: v.patch + 1, prerelease: "", build: "" };
      case "prerelease": {
        const parts = v.prerelease.split(".");
        const last = parts[parts.length - 1];
        const num = Number(last);
        if (!isNaN(num)) {
          parts[parts.length - 1] = String(num + 1);
        } else {
          parts.push("1");
        }
        return { ...v, prerelease: parts.join(".") };
      }
      default: return { ...v, patch: v.patch + 1, prerelease: "", build: "" };
    }
  }

  private check_range(v: SemVer, range: string): boolean {
    const parts = range.trim().split(/\s+/);
    for (const part of parts) {
      if (!this.check_comparator(v, part)) return false;
    }
    return true;
  }

  private check_comparator(v: SemVer, comp: string): boolean {
    const m = comp.match(/^(>=?|<=?|=|~|\^)?(\d+(?:\.\d+(?:\.\d+)?)?(?:-[a-zA-Z0-9.]+)?)$/);
    if (!m) return true;
    const op = m[1] || "=";
    const target = this.parse_loose(m[2]!);
    if (!target) return true;

    const cmp = this.compare_versions(v, target);
    switch (op) {
      case ">=": return cmp >= 0;
      case ">": return cmp > 0;
      case "<=": return cmp <= 0;
      case "<": return cmp < 0;
      case "=": return cmp === 0;
      case "~": return v.major === target.major && v.minor === target.minor && v.patch >= target.patch;
      case "^": return v.major === target.major && (v.minor > target.minor || (v.minor === target.minor && v.patch >= target.patch));
      default: return cmp === 0;
    }
  }

  private parse_loose(s: string): SemVer | null {
    const parts = s.split(".");
    return {
      major: Number(parts[0]) || 0,
      minor: Number(parts[1]) || 0,
      patch: Number(parts[2]) || 0,
      prerelease: "",
      build: "",
    };
  }
}
