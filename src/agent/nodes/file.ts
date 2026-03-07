/** File (파일 I/O) 노드 핸들러. */

import { readFile, writeFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import type { NodeHandler } from "../node-registry.js";
import type { FileNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const file_handler: NodeHandler = {
  node_type: "file",
  icon: "📄",
  color: "#7f8c8d",
  shape: "rect",
  output_schema: [
    { name: "content", type: "string",  description: "File content (read/extract)" },
    { name: "data",    type: "unknown", description: "Parsed data (extract)" },
    { name: "path",    type: "string",  description: "Resolved file path" },
  ],
  input_schema: [
    { name: "file_path", type: "string", description: "File path" },
    { name: "content",   type: "string", description: "Content to write" },
  ],
  create_default: () => ({ operation: "read", file_path: "", format: "text" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as FileNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const filePath = resolve_templates(n.file_path, tpl_ctx);
    const resolved = ctx.workspace ? pathResolve(ctx.workspace, filePath) : filePath;

    // 경로 순회 방지: resolve() 후 workspace 경계 검증
    if (ctx.workspace) {
      const ws = pathResolve(ctx.workspace);
      const norm = pathResolve(resolved);
      if (norm !== ws && !norm.startsWith(`${ws}/`) && !norm.startsWith(`${ws}\\`)) {
        throw new Error("path traversal not allowed: resolved path is outside workspace");
      }
    }

    switch (n.operation) {
      case "read": {
        const content = await readFile(resolved, "utf-8");
        return { output: { content, data: null, path: resolved } };
      }
      case "write": {
        const content = resolve_templates(n.content || "", tpl_ctx);
        await writeFile(resolved, content, "utf-8");
        return { output: { content, data: null, path: resolved } };
      }
      case "extract": {
        const raw = await readFile(resolved, "utf-8");
        let data: unknown = raw;
        if (n.format === "json") {
          data = JSON.parse(raw);
        } else if (n.format === "csv") {
          const lines = raw.split("\n").filter(Boolean);
          const headers = lines[0]?.split(",").map((h) => h.trim()) || [];
          data = lines.slice(1).map((line) => {
            const vals = line.split(",");
            const row: Record<string, string> = {};
            headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ""; });
            return row;
          });
        }
        return { output: { content: raw, data, path: resolved } };
      }
      default:
        throw new Error(`unknown file operation: ${n.operation}`);
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as FileNodeDefinition;
    const warnings: string[] = [];
    if (!n.file_path) warnings.push("file_path is empty");
    if (n.operation === "write" && !n.content) warnings.push("write operation with empty content");
    return { preview: { operation: n.operation, file_path: n.file_path, format: n.format || "text" }, warnings };
  },
};
