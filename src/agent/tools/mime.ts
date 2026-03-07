/** MIME 도구 — MIME 타입 조회/감지/확장자 매핑. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MIME_MAP: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".mjs": "application/javascript", ".json": "application/json", ".xml": "application/xml",
  ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown", ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml", ".toml": "application/toml", ".ini": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime",
  ".pdf": "application/pdf", ".zip": "application/zip", ".gz": "application/gzip",
  ".tar": "application/x-tar", ".rar": "application/vnd.rar", ".7z": "application/x-7z-compressed",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject", ".wasm": "application/wasm",
  ".ts": "application/typescript", ".tsx": "application/typescript", ".jsx": "application/javascript",
  ".sh": "application/x-sh", ".py": "text/x-python", ".rb": "text/x-ruby", ".go": "text/x-go",
  ".rs": "text/x-rust", ".java": "text/x-java", ".c": "text/x-c", ".cpp": "text/x-c++",
  ".sql": "application/sql", ".graphql": "application/graphql",
};

const REVERSE_MAP = new Map<string, string[]>();
for (const [ext, mime] of Object.entries(MIME_MAP)) {
  const list = REVERSE_MAP.get(mime) || [];
  list.push(ext);
  REVERSE_MAP.set(mime, list);
}

export class MimeTool extends Tool {
  readonly name = "mime";
  readonly category = "data" as const;
  readonly description = "MIME type utilities: lookup, reverse_lookup, detect, parse, is_text, is_binary, list.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["lookup", "reverse_lookup", "detect", "parse", "is_text", "is_binary", "list"], description: "Operation" },
      extension: { type: "string", description: "File extension (with or without dot)" },
      mime: { type: "string", description: "MIME type string" },
      filename: { type: "string", description: "Filename for detect" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "lookup");

    switch (action) {
      case "lookup": {
        let ext = String(params.extension || params.filename || "");
        const dot_idx = ext.lastIndexOf(".");
        if (dot_idx >= 0) ext = ext.slice(dot_idx);
        if (!ext.startsWith(".")) ext = `.${ext}`;
        ext = ext.toLowerCase();
        return JSON.stringify({ extension: ext, mime: MIME_MAP[ext] || "application/octet-stream" });
      }
      case "reverse_lookup": {
        const mime = String(params.mime || "").toLowerCase();
        return JSON.stringify({ mime, extensions: REVERSE_MAP.get(mime) || [] });
      }
      case "detect": {
        const filename = String(params.filename || "");
        const dot_idx = filename.lastIndexOf(".");
        const ext = dot_idx >= 0 ? filename.slice(dot_idx).toLowerCase() : "";
        const mime = MIME_MAP[ext] || "application/octet-stream";
        return JSON.stringify({ filename, extension: ext, mime, is_text: this.is_text_mime(mime) });
      }
      case "parse": {
        const mime = String(params.mime || "");
        const [type_subtype, ...param_parts] = mime.split(";");
        const [type, subtype] = (type_subtype || "").trim().split("/");
        const parsed_params: Record<string, string> = {};
        for (const p of param_parts) {
          const [k, v] = p.trim().split("=");
          if (k) parsed_params[k.trim()] = (v || "").trim().replace(/^"|"$/g, "");
        }
        return JSON.stringify({ type, subtype, full: type_subtype?.trim(), parameters: parsed_params });
      }
      case "is_text": {
        const mime = String(params.mime || "");
        return JSON.stringify({ mime, is_text: this.is_text_mime(mime) });
      }
      case "is_binary": {
        const mime = String(params.mime || "");
        return JSON.stringify({ mime, is_binary: !this.is_text_mime(mime) });
      }
      case "list": {
        return JSON.stringify({ count: Object.keys(MIME_MAP).length, entries: MIME_MAP });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private is_text_mime(mime: string): boolean {
    if (mime.startsWith("text/")) return true;
    const text_types = ["application/json", "application/xml", "application/javascript",
      "application/typescript", "application/sql", "application/graphql",
      "application/x-yaml", "application/toml", "application/x-sh"];
    return text_types.includes(mime);
  }
}
