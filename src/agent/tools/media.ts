/** Media 도구 — 미디어 파일 타입 감지, 메타데이터 추출, base64 변환. */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".pdf": "application/pdf", ".json": "application/json", ".xml": "application/xml",
};

function detect_mime(path: string): string {
  return EXT_MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

function media_category(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("pdf")) return "document";
  return "unknown";
}

function format_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export class MediaTool extends Tool {
  readonly name = "media";
  readonly category = "external" as const;
  readonly description = "Media file operations: detect_type, metadata, to_base64, from_base64.";
  readonly policy_flags = { write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["detect_type", "metadata", "to_base64", "from_base64"], description: "Operation" },
      path: { type: "string", description: "File path" },
      data: { type: "string", description: "Base64 or data URI (for from_base64)" },
      output_path: { type: "string", description: "Output path (for from_base64)" },
    },
    required: ["action"],
    additionalProperties: false,
  };
  private readonly workspace: string;

  constructor(opts: { workspace: string }) {
    super();
    this.workspace = opts.workspace;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "detect_type");
    const path_str = String(params.path || "");

    switch (action) {
      case "detect_type": {
        if (!path_str) return "Error: path is required";
        const abs = this.safe_resolve(path_str);
        const mime = detect_mime(abs);
        return JSON.stringify({ mime, category: media_category(mime), path: abs });
      }
      case "metadata": {
        if (!path_str) return "Error: path is required";
        const abs = this.safe_resolve(path_str);
        const info = await stat(abs);
        const mime = detect_mime(abs);
        return JSON.stringify({
          name: basename(abs), ext: extname(abs), mime,
          category: media_category(mime),
          size_bytes: info.size, size_human: format_size(info.size),
          created: info.birthtime.toISOString(), modified: info.mtime.toISOString(),
        });
      }
      case "to_base64": {
        if (!path_str) return "Error: path is required";
        const abs = this.safe_resolve(path_str);
        const buf = await readFile(abs);
        const mime = detect_mime(abs);
        return JSON.stringify({ data_uri: `data:${mime};base64,${buf.toString("base64")}`, mime, size: buf.length });
      }
      case "from_base64": {
        const data = String(params.data || "");
        const out = String(params.output_path || "output.bin");
        if (!data) return "Error: data is required";
        const abs = this.safe_resolve(out);
        const b64 = data.includes(",") ? data.split(",")[1]! : data;
        const buf = Buffer.from(b64, "base64");
        await writeFile(abs, buf);
        return JSON.stringify({ path: abs, size: buf.length, mime: detect_mime(abs) });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private safe_resolve(p: string): string {
    const abs = resolve(this.workspace, p);
    const ws = resolve(this.workspace);
    if (!abs.startsWith(ws)) throw new Error("path traversal blocked");
    return abs;
  }
}
