/** Diff 도구 — 텍스트/파일 비교, unified diff 생성, patch 적용. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { readFile, writeFile } from "node:fs/promises";
import { error_message } from "../../utils/common.js";

const MAX_SIZE = 1024 * 512;

export class DiffTool extends Tool {
  readonly name = "diff";
  readonly category = "memory" as const;
  readonly description = "Compare texts or files and produce unified diffs, apply patches, or render formatted diffs for display.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["compare", "patch", "stats", "render"],
        description: "compare: produce diff, patch: apply diff, stats: summary, render: formatted diff for display",
      },
      old_text: { type: "string", description: "Original text (or file path with @file:)" },
      new_text: { type: "string", description: "Modified text (or file path with @file:)" },
      diff_text: { type: "string", description: "Unified diff text (for patch operation)" },
      target: { type: "string", description: "File path to apply patch to (for patch)" },
      context_lines: { type: "integer", minimum: 0, maximum: 20, description: "Context lines in diff (default 3)" },
      format: { type: "string", enum: ["markdown", "slack", "html", "plain"], description: "Output format for render operation (default markdown)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "compare");

    try {
      switch (op) {
        case "compare": return await this.compare(params);
        case "patch": return await this.apply_patch(params);
        case "stats": return await this.stats(params);
        case "render": return await this.render(params);
        default: return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async resolve_text(raw: unknown): Promise<string> {
    const s = String(raw || "");
    if (s.startsWith("@file:")) {
      const path = s.slice(6).trim();
      const content = await readFile(path, "utf-8");
      if (content.length > MAX_SIZE) throw new Error(`file too large: ${path}`);
      return content;
    }
    if (s.length > MAX_SIZE) throw new Error("text too large");
    return s;
  }

  private async compare(params: Record<string, unknown>): Promise<string> {
    const old_text = await this.resolve_text(params.old_text);
    const new_text = await this.resolve_text(params.new_text);
    const ctx = Math.min(20, Math.max(0, Number(params.context_lines ?? 3)));

    const old_lines = old_text.split("\n");
    const new_lines = new_text.split("\n");

    if (old_text === new_text) return "(no differences)";

    const hunks = this.compute_diff_hunks(old_lines, new_lines, ctx);
    const header = [
      "--- a",
      "+++ b",
      ...hunks,
    ];
    return header.join("\n");
  }

  private compute_diff_hunks(old_lines: string[], new_lines: string[], ctx: number): string[] {
    const lcs = this.lcs_indices(old_lines, new_lines);
    const changes: { type: "keep" | "del" | "add"; old_idx: number; new_idx: number; line: string }[] = [];

    let oi = 0, ni = 0, li = 0;
    while (oi < old_lines.length || ni < new_lines.length) {
      if (li < lcs.length && lcs[li][0] === oi && lcs[li][1] === ni) {
        changes.push({ type: "keep", old_idx: oi, new_idx: ni, line: old_lines[oi] });
        oi++; ni++; li++;
      } else if (li < lcs.length && lcs[li][0] > oi) {
        changes.push({ type: "del", old_idx: oi, new_idx: ni, line: old_lines[oi] });
        oi++;
      } else if (li < lcs.length && lcs[li][1] > ni) {
        changes.push({ type: "add", old_idx: oi, new_idx: ni, line: new_lines[ni] });
        ni++;
      } else if (oi < old_lines.length) {
        changes.push({ type: "del", old_idx: oi, new_idx: ni, line: old_lines[oi] });
        oi++;
      } else {
        changes.push({ type: "add", old_idx: oi, new_idx: ni, line: new_lines[ni] });
        ni++;
      }
    }

    const result: string[] = [];
    let i = 0;
    while (i < changes.length) {
      while (i < changes.length && changes[i].type === "keep") i++;
      if (i >= changes.length) break;

      const start = Math.max(0, i - ctx);
      let end = i;
      while (end < changes.length) {
        if (changes[end].type !== "keep") { end++; continue; }
        let keep_run = 0;
        let j = end;
        while (j < changes.length && changes[j].type === "keep") { keep_run++; j++; }
        if (keep_run > ctx * 2 && j < changes.length) { end += ctx; break; }
        if (j >= changes.length) { end = Math.min(changes.length, end + ctx); break; }
        end = j;
      }

      const hunk_old_start = start < changes.length ? changes[start].old_idx + 1 : 1;
      const hunk_new_start = start < changes.length ? changes[start].new_idx + 1 : 1;
      let old_count = 0, new_count = 0;
      const lines: string[] = [];
      for (let k = start; k < end; k++) {
        const c = changes[k];
        if (c.type === "keep") { lines.push(` ${c.line}`); old_count++; new_count++; }
        else if (c.type === "del") { lines.push(`-${c.line}`); old_count++; }
        else { lines.push(`+${c.line}`); new_count++; }
      }
      result.push(`@@ -${hunk_old_start},${old_count} +${hunk_new_start},${new_count} @@`);
      result.push(...lines);
      i = end;
    }

    return result;
  }

  private lcs_indices(a: string[], b: string[]): [number, number][] {
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return [];
    const max_len = Math.min(m, n);
    if (max_len > 5000) return this.lcs_indices_greedy(a, b);

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const result: [number, number][] = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { result.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return result;
  }

  private lcs_indices_greedy(a: string[], b: string[]): [number, number][] {
    const b_map = new Map<string, number[]>();
    b.forEach((line, idx) => {
      const arr = b_map.get(line);
      if (arr) arr.push(idx); else b_map.set(line, [idx]);
    });
    const result: [number, number][] = [];
    let last_j = -1;
    for (let i = 0; i < a.length; i++) {
      const positions = b_map.get(a[i]);
      if (!positions) continue;
      const j = positions.find((p) => p > last_j);
      if (j !== undefined) { result.push([i, j]); last_j = j; }
    }
    return result;
  }

  private async apply_patch(params: Record<string, unknown>): Promise<string> {
    const diff_text = String(params.diff_text || "");
    if (!diff_text.trim()) return "Error: diff_text is required";

    const target_path = String(params.target || "").trim();
    let original = "";
    if (target_path) {
      original = await readFile(target_path, "utf-8");
    } else {
      original = await this.resolve_text(params.old_text);
    }

    const lines = original.split("\n");
    const diff_lines = diff_text.split("\n");
    let offset = 0;

    for (let i = 0; i < diff_lines.length; i++) {
      const hunk_match = diff_lines[i].match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (!hunk_match) continue;

      const old_start = parseInt(hunk_match[1], 10) - 1 + offset;
      const removals: number[] = [];
      const additions: { idx: number; line: string }[] = [];
      let pos = old_start;

      for (let j = i + 1; j < diff_lines.length; j++) {
        const dl = diff_lines[j];
        if (dl.startsWith("@@") || dl.startsWith("---") || dl.startsWith("+++")) { i = j - 1; break; }
        if (dl.startsWith("-")) { removals.push(pos); pos++; }
        else if (dl.startsWith("+")) { additions.push({ idx: pos, line: dl.slice(1) }); }
        else { pos++; }
        if (j === diff_lines.length - 1) i = j;
      }

      for (let r = removals.length - 1; r >= 0; r--) {
        lines.splice(removals[r], 1);
      }
      offset -= removals.length;

      let insert_at = removals.length > 0 ? removals[0] : old_start;
      for (const a of additions) {
        lines.splice(insert_at, 0, a.line);
        insert_at++;
        offset++;
      }
    }

    const result = lines.join("\n");
    if (target_path) {
      await writeFile(target_path, result, "utf-8");
      return `Patched ${target_path} (${lines.length} lines)`;
    }
    return result;
  }

  private async stats(params: Record<string, unknown>): Promise<string> {
    const old_text = await this.resolve_text(params.old_text);
    const new_text = await this.resolve_text(params.new_text);
    const old_lines = old_text.split("\n");
    const new_lines = new_text.split("\n");
    const lcs = this.lcs_indices(old_lines, new_lines);
    const common = lcs.length;
    const added = new_lines.length - common;
    const removed = old_lines.length - common;

    return JSON.stringify({
      old_lines: old_lines.length,
      new_lines: new_lines.length,
      added,
      removed,
      changed: added + removed,
      similarity: old_lines.length > 0 ? `${Math.round((common / old_lines.length) * 100)}%` : "N/A",
    }, null, 2);
  }

  /** 비교 결과를 provider별 시각 포맷으로 렌더링. */
  private async render(params: Record<string, unknown>): Promise<string> {
    const format = String(params.format || "markdown").toLowerCase();
    let diff_text = String(params.diff_text || "").trim();

    // diff_text가 없으면 old_text/new_text에서 생성
    if (!diff_text) {
      const old_text = await this.resolve_text(params.old_text);
      const new_text = await this.resolve_text(params.new_text);
      if (old_text === new_text) return "(no differences)";
      diff_text = await this.compare(params);
    }

    const lines = diff_text.split("\n");
    let added = 0, removed = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }

    switch (format) {
      case "slack": return this.render_slack(lines, added, removed);
      case "html": return this.render_html(lines, added, removed);
      case "plain": return this.render_plain(lines, added, removed);
      default: return this.render_markdown(lines, added, removed);
    }
  }

  private render_markdown(lines: string[], added: number, removed: number): string {
    const header = `**Diff** — \`+${added}\` / \`-${removed}\`\n`;
    const body = "```diff\n" + lines.join("\n") + "\n```";
    return header + body;
  }

  private render_slack(lines: string[], added: number, removed: number): string {
    const header = `*Diff* — \`+${added}\` / \`-${removed}\`\n`;
    const body = "```\n" + lines.join("\n") + "\n```";
    return header + body;
  }

  private render_html(lines: string[], added: number, removed: number): string {
    const header = `<b>Diff</b> — <code>+${added}</code> / <code>-${removed}</code>\n`;
    const formatted = lines.map((line) => {
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (line.startsWith("+") && !line.startsWith("+++")) return `<span style="color:green">${escaped}</span>`;
      if (line.startsWith("-") && !line.startsWith("---")) return `<span style="color:red">${escaped}</span>`;
      if (line.startsWith("@@")) return `<span style="color:cyan">${escaped}</span>`;
      return escaped;
    });
    return header + "<pre>" + formatted.join("\n") + "</pre>";
  }

  private render_plain(lines: string[], added: number, removed: number): string {
    const header = `Diff — +${added} / -${removed}\n${"─".repeat(40)}\n`;
    return header + lines.join("\n");
  }
}
