/** JSON Patch 도구 — RFC 6902 JSON Patch 적용/생성/검증. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type PatchOp = { op: string; path: string; value?: unknown; from?: string };

export class JsonPatchTool extends Tool {
  readonly name = "json_patch";
  readonly category = "data" as const;
  readonly description = "JSON Patch (RFC 6902): apply, diff, validate, test.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["apply", "diff", "validate", "test"], description: "JSON Patch operation" },
      document: { type: "string", description: "JSON document string" },
      patch: { type: "string", description: "JSON Patch array string" },
      target: { type: "string", description: "Target JSON for diff" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "apply");

    switch (action) {
      case "apply": {
        let doc: unknown;
        let patch: PatchOp[];
        try { doc = JSON.parse(String(params.document || "{}")); } catch { return "Error: invalid document JSON"; }
        try { patch = JSON.parse(String(params.patch || "[]")); } catch { return "Error: invalid patch JSON"; }
        if (!Array.isArray(patch)) return "Error: patch must be an array";
        const result = this.apply_patch(doc, patch);
        if (result.error) return JSON.stringify({ error: result.error });
        return JSON.stringify({ result: result.value });
      }
      case "diff": {
        let source: unknown;
        let target: unknown;
        try { source = JSON.parse(String(params.document || "{}")); } catch { return "Error: invalid document JSON"; }
        try { target = JSON.parse(String(params.target || "{}")); } catch { return "Error: invalid target JSON"; }
        const patch = this.generate_diff(source, target, "");
        return JSON.stringify({ patch, count: patch.length });
      }
      case "validate": {
        let patch: PatchOp[];
        try { patch = JSON.parse(String(params.patch || "[]")); } catch { return JSON.stringify({ valid: false, error: "invalid JSON" }); }
        if (!Array.isArray(patch)) return JSON.stringify({ valid: false, error: "patch must be an array" });
        for (let i = 0; i < patch.length; i++) {
          const op = patch[i]!;
          if (!op.op || !op.path) return JSON.stringify({ valid: false, error: `operation ${i}: missing op or path` });
          if (!["add", "remove", "replace", "move", "copy", "test"].includes(op.op)) {
            return JSON.stringify({ valid: false, error: `operation ${i}: unknown op "${op.op}"` });
          }
        }
        return JSON.stringify({ valid: true, count: patch.length });
      }
      case "test": {
        let doc: unknown;
        let patch: PatchOp[];
        try { doc = JSON.parse(String(params.document || "{}")); } catch { return "Error: invalid document JSON"; }
        try { patch = JSON.parse(String(params.patch || "[]")); } catch { return "Error: invalid patch JSON"; }
        const result = this.apply_patch(doc, patch);
        return JSON.stringify({ success: !result.error, error: result.error || undefined });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private resolve_pointer(doc: unknown, path: string): { parent: unknown; key: string; value: unknown } | null {
    if (path === "") return { parent: null, key: "", value: doc };
    const parts = path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let current: unknown = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current === null || typeof current !== "object") return null;
      const key = Array.isArray(current) ? Number(parts[i]) : parts[i]!;
      current = (current as Record<string, unknown>)[String(key)];
    }
    const last_key = parts[parts.length - 1]!;
    return { parent: current, key: last_key, value: current !== null && typeof current === "object" ? (current as Record<string, unknown>)[last_key] : undefined };
  }

  private apply_patch(doc: unknown, patch: PatchOp[]): { value?: unknown; error?: string } {
    let result = JSON.parse(JSON.stringify(doc));
    for (let i = 0; i < patch.length; i++) {
      const op = patch[i]!;
      switch (op.op) {
        case "add": {
          result = this.set_value(result, op.path, op.value);
          break;
        }
        case "remove": {
          const resolved = this.resolve_pointer(result, op.path);
          if (!resolved || resolved.parent === null) return { error: `op ${i}: path not found: ${op.path}` };
          if (Array.isArray(resolved.parent)) resolved.parent.splice(Number(resolved.key), 1);
          else delete (resolved.parent as Record<string, unknown>)[resolved.key];
          break;
        }
        case "replace": {
          const resolved = this.resolve_pointer(result, op.path);
          if (!resolved || resolved.parent === null) return { error: `op ${i}: path not found: ${op.path}` };
          if (Array.isArray(resolved.parent)) resolved.parent[Number(resolved.key)] = op.value;
          else (resolved.parent as Record<string, unknown>)[resolved.key] = op.value;
          break;
        }
        case "test": {
          const resolved = this.resolve_pointer(result, op.path);
          if (!resolved) return { error: `op ${i}: path not found: ${op.path}` };
          if (JSON.stringify(resolved.value) !== JSON.stringify(op.value)) {
            return { error: `op ${i}: test failed at ${op.path}` };
          }
          break;
        }
        case "move": {
          if (!op.from) return { error: `op ${i}: move requires from` };
          const from_resolved = this.resolve_pointer(result, op.from);
          if (!from_resolved || from_resolved.parent === null) return { error: `op ${i}: from path not found` };
          const val = JSON.parse(JSON.stringify(from_resolved.value));
          if (Array.isArray(from_resolved.parent)) from_resolved.parent.splice(Number(from_resolved.key), 1);
          else delete (from_resolved.parent as Record<string, unknown>)[from_resolved.key];
          result = this.set_value(result, op.path, val);
          break;
        }
        case "copy": {
          if (!op.from) return { error: `op ${i}: copy requires from` };
          const from_resolved = this.resolve_pointer(result, op.from);
          if (!from_resolved) return { error: `op ${i}: from path not found` };
          result = this.set_value(result, op.path, JSON.parse(JSON.stringify(from_resolved.value)));
          break;
        }
        default:
          return { error: `op ${i}: unknown operation "${op.op}"` };
      }
    }
    return { value: result };
  }

  private set_value(doc: unknown, path: string, value: unknown): unknown {
    if (path === "") return value;
    const parts = path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    const result = JSON.parse(JSON.stringify(doc ?? {}));
    let current: unknown = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      if (current !== null && typeof current === "object") {
        if (!(key in (current as Record<string, unknown>))) {
          (current as Record<string, unknown>)[key] = {};
        }
        current = (current as Record<string, unknown>)[key];
      }
    }
    const last_key = parts[parts.length - 1]!;
    if (current !== null && typeof current === "object") {
      if (Array.isArray(current)) {
        if (last_key === "-") current.push(value);
        else current.splice(Number(last_key), 0, value);
      } else {
        (current as Record<string, unknown>)[last_key] = value;
      }
    }
    return result;
  }

  private generate_diff(source: unknown, target: unknown, path: string): PatchOp[] {
    if (JSON.stringify(source) === JSON.stringify(target)) return [];

    if (source === null || target === null || typeof source !== typeof target || Array.isArray(source) !== Array.isArray(target)) {
      return path === "" ? [{ op: "replace", path: path || "/", value: target }] : [{ op: "replace", path, value: target }];
    }

    if (typeof source !== "object") {
      return [{ op: "replace", path, value: target }];
    }

    const ops: PatchOp[] = [];
    const s = source as Record<string, unknown>;
    const t = target as Record<string, unknown>;

    for (const key of Object.keys(s)) {
      const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
      if (!(key in t)) ops.push({ op: "remove", path: `${path}/${escaped}` });
      else ops.push(...this.generate_diff(s[key], t[key], `${path}/${escaped}`));
    }
    for (const key of Object.keys(t)) {
      if (!(key in s)) {
        const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
        ops.push({ op: "add", path: `${path}/${escaped}`, value: t[key] });
      }
    }
    return ops;
  }
}
