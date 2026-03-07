/** Changelog 도구 — Conventional Commits 파싱/CHANGELOG 생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface ConventionalCommit {
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
  body?: string;
  hash?: string;
}

const COMMIT_RE = /^(\w+)(?:\(([^)]*)\))?(!?):\s*(.+)$/;

const TYPE_LABELS: Record<string, string> = {
  feat: "Features", fix: "Bug Fixes", docs: "Documentation",
  style: "Styles", refactor: "Code Refactoring", perf: "Performance",
  test: "Tests", build: "Build System", ci: "CI", chore: "Chores",
  revert: "Reverts",
};

export class ChangelogTool extends Tool {
  readonly name = "changelog";
  readonly category = "data" as const;
  readonly description = "Changelog utilities: parse_commits, generate, group_by_type, format_entry, validate_commit.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse_commits", "generate", "group_by_type", "format_entry", "validate_commit"], description: "Operation" },
      commits: { type: "string", description: "Newline-separated commit messages or JSON array" },
      version: { type: "string", description: "Version string (generate)" },
      date: { type: "string", description: "Release date (generate, default: today)" },
      message: { type: "string", description: "Single commit message (validate_commit/format_entry)" },
      repo_url: { type: "string", description: "Repository URL for links" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse_commits");

    switch (action) {
      case "parse_commits": {
        const commits = this.get_commits(params);
        const parsed = commits.map((c) => this.parse_commit(c));
        return JSON.stringify({ count: parsed.length, commits: parsed });
      }
      case "generate": {
        const commits = this.get_commits(params);
        const version = String(params.version || "Unreleased");
        const date = String(params.date || new Date().toISOString().slice(0, 10));
        const parsed = commits.map((c) => this.parse_commit(c)).filter((c) => c.type);
        const grouped = this.group_commits(parsed);
        return this.format_changelog(version, date, grouped, params.repo_url ? String(params.repo_url) : undefined);
      }
      case "group_by_type": {
        const commits = this.get_commits(params);
        const parsed = commits.map((c) => this.parse_commit(c)).filter((c) => c.type);
        const grouped = this.group_commits(parsed);
        const result: Record<string, ConventionalCommit[]> = {};
        for (const [k, v] of grouped) result[k] = v;
        return JSON.stringify(result);
      }
      case "format_entry": {
        const msg = String(params.message || "");
        const parsed = this.parse_commit(msg);
        if (!parsed.type) return JSON.stringify({ error: "not a conventional commit" });
        const scope = parsed.scope ? `**${parsed.scope}:** ` : "";
        const breaking = parsed.breaking ? " **BREAKING CHANGE**" : "";
        return `- ${scope}${parsed.description}${breaking}`;
      }
      case "validate_commit": {
        const msg = String(params.message || "");
        const errors: string[] = [];
        const m = COMMIT_RE.exec(msg.split("\n")[0]);
        if (!m) {
          errors.push("does not match conventional commit format: type(scope)?: description");
        } else {
          const type = m[1];
          if (!TYPE_LABELS[type]) errors.push(`unknown type '${type}', expected: ${Object.keys(TYPE_LABELS).join(", ")}`);
          if (!m[4] || m[4].length < 3) errors.push("description too short");
          if (m[4] && m[4][0] === m[4][0].toUpperCase()) errors.push("description should start with lowercase");
        }
        return JSON.stringify({ valid: errors.length === 0, errors, parsed: m ? this.parse_commit(msg) : null });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private get_commits(params: Record<string, unknown>): string[] {
    const raw = String(params.commits || "");
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(String);
    } catch { /* not JSON */ }
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  private parse_commit(msg: string): ConventionalCommit {
    const lines = msg.split("\n");
    const first = lines[0];
    const m = COMMIT_RE.exec(first);
    if (!m) return { type: "", description: first, breaking: false };
    return {
      type: m[1],
      scope: m[2] || undefined,
      breaking: m[3] === "!" || lines.some((l) => l.startsWith("BREAKING CHANGE:")),
      description: m[4],
      body: lines.slice(1).join("\n").trim() || undefined,
    };
  }

  private group_commits(commits: ConventionalCommit[]): Map<string, ConventionalCommit[]> {
    const groups = new Map<string, ConventionalCommit[]>();
    const breaking: ConventionalCommit[] = [];
    for (const c of commits) {
      if (c.breaking) breaking.push(c);
      const label = TYPE_LABELS[c.type] || c.type;
      const list = groups.get(label) || [];
      list.push(c);
      groups.set(label, list);
    }
    if (breaking.length > 0) {
      const existing = groups.get("BREAKING CHANGES") || [];
      groups.set("BREAKING CHANGES", [...existing, ...breaking]);
    }
    return groups;
  }

  private format_changelog(version: string, date: string, groups: Map<string, ConventionalCommit[]>, repo_url?: string): string {
    const lines: string[] = [];
    lines.push(`## [${version}] - ${date}\n`);
    const order = ["BREAKING CHANGES", "Features", "Bug Fixes", "Performance", "Code Refactoring", "Documentation", "Tests", "Build System", "CI", "Chores", "Reverts"];
    for (const label of order) {
      const commits = groups.get(label);
      if (!commits || commits.length === 0) continue;
      lines.push(`### ${label}\n`);
      for (const c of commits) {
        const scope = c.scope ? `**${c.scope}:** ` : "";
        const hash = c.hash && repo_url ? ` ([${c.hash.slice(0, 7)}](${repo_url}/commit/${c.hash}))` : "";
        lines.push(`- ${scope}${c.description}${hash}`);
      }
      lines.push("");
    }
    // remaining groups not in order
    for (const [label, commits] of groups) {
      if (order.includes(label)) continue;
      lines.push(`### ${label}\n`);
      for (const c of commits) {
        const scope = c.scope ? `**${c.scope}:** ` : "";
        lines.push(`- ${scope}${c.description}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}
