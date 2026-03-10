/** Encoding 노드 핸들러 — 워크플로우에서 인코딩/디코딩/해시/UUID. */

import type { NodeHandler } from "../node-registry.js";
import type { EncodingNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { createHash, randomUUID } from "node:crypto";

export const encoding_handler: NodeHandler = {
  node_type: "encoding",
  icon: "\u{1F510}",
  color: "#4527a0",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Encoded/decoded/hashed output" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "encode/decode/hash/uuid" },
    { name: "input",     type: "string", description: "Input string" },
    { name: "format",    type: "string", description: "Format (base64/hex/url/sha256/sha512/md5)" },
  ],
  create_default: () => ({ operation: "encode", input: "", format: "base64", count: 1, base_from: "dec", base_to: "hex" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as EncodingNodeDefinition;
    const tpl = { memory: ctx.memory };
    const input = resolve_templates(n.input || "", tpl);
    const op = n.operation || "encode";
    const format = n.format || "base64";

    try {
      let result: string;
      switch (op) {
        case "encode":
          result = format === "base64" ? Buffer.from(input, "utf-8").toString("base64")
            : format === "hex" ? Buffer.from(input, "utf-8").toString("hex")
            : format === "url" ? encodeURIComponent(input) : `Unsupported: ${format}`;
          break;
        case "decode":
          result = format === "base64" ? Buffer.from(input, "base64").toString("utf-8")
            : format === "hex" ? Buffer.from(input, "hex").toString("utf-8")
            : format === "url" ? decodeURIComponent(input) : `Unsupported: ${format}`;
          break;
        case "hash": {
          const algo = format === "sha256" ? "sha256" : format === "sha512" ? "sha512" : format === "md5" ? "md5" : null;
          if (!algo) { result = `Unsupported hash: ${format}`; break; }
          result = createHash(algo).update(input, "utf-8").digest("hex");
          break;
        }
        case "uuid": {
          const count = Math.min(100, Math.max(1, n.count || 1));
          result = Array.from({ length: count }, () => randomUUID()).join("\n");
          break;
        }
        case "base_convert": {
          const { BaseConvertTool } = await import("../tools/base-convert.js");
          const tool = new BaseConvertTool();
          const raw = await tool.execute({ action: "convert", value: input, from: n.base_from || "dec", to: n.base_to || "hex" });
          const parsed = JSON.parse(raw);
          result = parsed.result ?? parsed.error ?? raw;
          break;
        }
        case "msgpack_encode": {
          const { MsgpackTool } = await import("../tools/msgpack.js");
          const tool = new MsgpackTool();
          const raw = await tool.execute({ action: "encode", data: input });
          const parsed = JSON.parse(raw);
          result = parsed.hex ?? parsed.error ?? raw;
          break;
        }
        case "msgpack_decode": {
          const { MsgpackTool } = await import("../tools/msgpack.js");
          const tool = new MsgpackTool();
          const raw = await tool.execute({ action: "decode", hex: input });
          const parsed = JSON.parse(raw);
          result = parsed.error ? parsed.error : JSON.stringify(parsed.data);
          break;
        }
        default:
          result = `Unsupported: ${op}`;
      }
      return { output: { result, success: !String(result).startsWith("Error:") && !String(result).startsWith("Unsupported:") } };
    } catch (err) {
      return { output: { result: (err as Error).message, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as EncodingNodeDefinition;
    const warnings: string[] = [];
    if (n.operation !== "uuid" && !n.input?.trim()) warnings.push("input is required");
    return { preview: { operation: n.operation, format: n.format }, warnings };
  },
};
