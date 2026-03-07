/** Media 노드 핸들러 — 미디어 타입 감지, 메타데이터 추출, 트랜스코드, 썸네일, base64 변환. */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve as pathResolve, extname, basename } from "node:path";
import type { NodeHandler } from "../node-registry.js";
import type { MediaNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

/** 확장자 → MIME 매핑 (자주 사용되는 미디어 타입). */
const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".aac": "audio/aac", ".m4a": "audio/mp4", ".wma": "audio/x-ms-wma",
  ".mp4": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".wmv": "video/x-ms-wmv",
  ".pdf": "application/pdf", ".json": "application/json", ".xml": "application/xml",
};

function detect_mime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXT_MIME[ext] || "application/octet-stream";
}

function media_category(mime: string): "image" | "audio" | "video" | "document" | "unknown" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("application/pdf") || mime.startsWith("application/json") || mime.startsWith("application/xml") || mime.startsWith("text/")) return "document";
  return "unknown";
}

function resolve_safe(workspace: string | undefined, raw: string): string {
  const resolved = workspace ? pathResolve(workspace, raw) : pathResolve(raw);
  if (workspace) {
    const ws = pathResolve(workspace);
    const norm = pathResolve(resolved);
    if (norm !== ws && !norm.startsWith(`${ws}/`) && !norm.startsWith(`${ws}\\`)) {
      throw new Error("path traversal not allowed: resolved path is outside workspace");
    }
  }
  return resolved;
}

export const media_handler: NodeHandler = {
  node_type: "media",
  icon: "\u{1F3AC}",
  color: "#8e44ad",
  shape: "rect",
  output_schema: [
    { name: "mime_type", type: "string",  description: "Detected MIME type" },
    { name: "category",  type: "string",  description: "image / audio / video / document / unknown" },
    { name: "metadata",  type: "object",  description: "Extracted metadata (size, name, ext)" },
    { name: "result",    type: "string",  description: "Operation result (path or base64 data)" },
    { name: "success",   type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "detect_type / extract_metadata / to_base64 / from_base64" },
    { name: "input_path", type: "string", description: "Input file path" },
  ],
  create_default: () => ({
    operation: "detect_type",
    input_path: "",
    output_path: "",
    target_format: "",
    mime_type: "",
    thumb_width: 200,
    thumb_height: 200,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MediaNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = n.operation || "detect_type";

    try {
      switch (op) {
        case "detect_type": {
          const inputPath = resolve_safe(ctx.workspace, resolve_templates(n.input_path || "", tpl));
          const mime = detect_mime(inputPath);
          const cat = media_category(mime);
          return { output: { mime_type: mime, category: cat, metadata: null, result: mime, success: true } };
        }

        case "extract_metadata": {
          const inputPath = resolve_safe(ctx.workspace, resolve_templates(n.input_path || "", tpl));
          const info = await stat(inputPath);
          const mime = detect_mime(inputPath);
          const meta = {
            name: basename(inputPath),
            ext: extname(inputPath),
            mime,
            category: media_category(mime),
            size_bytes: info.size,
            size_human: format_size(info.size),
            created: info.birthtime.toISOString(),
            modified: info.mtime.toISOString(),
          };
          return { output: { mime_type: mime, category: meta.category, metadata: meta, result: JSON.stringify(meta), success: true } };
        }

        case "to_base64": {
          const inputPath = resolve_safe(ctx.workspace, resolve_templates(n.input_path || "", tpl));
          const buf = await readFile(inputPath);
          const mime = n.mime_type || detect_mime(inputPath);
          const b64 = buf.toString("base64");
          const dataUri = `data:${mime};base64,${b64}`;
          return { output: { mime_type: mime, category: media_category(mime), metadata: { size_bytes: buf.length }, result: dataUri, success: true } };
        }

        case "from_base64": {
          const outputPath = resolve_safe(ctx.workspace, resolve_templates(n.output_path || "output.bin", tpl));
          const inputData = resolve_templates(n.input_path || "", tpl);
          // data URI 또는 raw base64
          const b64 = inputData.includes(",") ? inputData.split(",")[1]! : inputData;
          const buf = Buffer.from(b64, "base64");
          await writeFile(outputPath, buf);
          const mime = detect_mime(outputPath);
          return { output: { mime_type: mime, category: media_category(mime), metadata: { size_bytes: buf.length, path: outputPath }, result: outputPath, success: true } };
        }

        default:
          return { output: { mime_type: "", category: "unknown", metadata: null, result: `Unknown operation: ${op}`, success: false } };
      }
    } catch (err) {
      return { output: { mime_type: "", category: "unknown", metadata: null, result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MediaNodeDefinition;
    const warnings: string[] = [];
    if (!n.input_path?.trim() && n.operation !== "from_base64") warnings.push("input_path is required");
    if (n.operation === "from_base64" && !n.output_path?.trim()) warnings.push("output_path is required for from_base64");
    return { preview: { operation: n.operation }, warnings };
  },
};

function format_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
