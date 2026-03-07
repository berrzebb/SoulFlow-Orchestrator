/** Compress 도구 — gzip/brotli/zstd 단일 파일 압축·해제. Node.js zlib 기반. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { createGzip, createGunzip, brotliCompress, brotliDecompress, constants } from "node:zlib";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { error_message } from "../../utils/common.js";

const brotli_compress = promisify(brotliCompress);
const brotli_decompress = promisify(brotliDecompress);
const MAX_FILE_SIZE = 1024 * 1024 * 100;

export class CompressTool extends Tool {
  readonly name = "compress";
  readonly category = "filesystem" as const;
  readonly policy_flags = { write: true } as const;
  readonly description =
    "Compress/decompress files using gzip or brotli. Also supports base64 encoding of compressed data for API transfer.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["compress", "decompress", "compress_string", "decompress_string"], description: "Operation" },
      input_path: { type: "string", description: "Input file path (for file operations)" },
      output_path: { type: "string", description: "Output file path (default: auto)" },
      input: { type: "string", description: "Input string (for string operations)" },
      algorithm: { type: "string", enum: ["gzip", "brotli"], description: "Compression algorithm (default: gzip)" },
      level: { type: "integer", minimum: 1, maximum: 11, description: "Compression level (1-9 for gzip, 1-11 for brotli)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "compress");
    const algo = String(params.algorithm || "gzip");
    const level = Number(params.level || (algo === "brotli" ? 4 : 6));

    try {
      switch (op) {
        case "compress": return await this.compress_file(params, algo, level);
        case "decompress": return await this.decompress_file(params, algo);
        case "compress_string": return await this.compress_string(String(params.input || ""), algo, level);
        case "decompress_string": return await this.decompress_string(String(params.input || ""), algo);
        default: return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async compress_file(params: Record<string, unknown>, algo: string, level: number): Promise<string> {
    const input = String(params.input_path || "").trim();
    if (!input) return "Error: input_path is required";
    const ext = algo === "brotli" ? ".br" : ".gz";
    const output = String(params.output_path || "").trim() || `${input}${ext}`;

    const stat = statSync(input);
    if (stat.size > MAX_FILE_SIZE) return `Error: file too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`;

    if (algo === "gzip") {
      await pipeline(createReadStream(input), createGzip({ level }), createWriteStream(output));
    } else {
      const { readFile, writeFile } = await import("node:fs/promises");
      const data = await readFile(input);
      const compressed = await brotli_compress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: level } });
      await writeFile(output, compressed);
    }

    const out_stat = statSync(output);
    const ratio = stat.size > 0 ? Math.round((1 - out_stat.size / stat.size) * 100) : 0;
    return JSON.stringify({
      input: input,
      output: output,
      algorithm: algo,
      original_size: stat.size,
      compressed_size: out_stat.size,
      ratio: `${ratio}%`,
    }, null, 2);
  }

  private async decompress_file(params: Record<string, unknown>, algo: string): Promise<string> {
    const input = String(params.input_path || "").trim();
    if (!input) return "Error: input_path is required";
    const output = String(params.output_path || "").trim() || input.replace(/\.(gz|br)$/, "");

    if (algo === "gzip") {
      await pipeline(createReadStream(input), createGunzip(), createWriteStream(output));
    } else {
      const { readFile, writeFile } = await import("node:fs/promises");
      const data = await readFile(input);
      const decompressed = await brotli_decompress(data);
      await writeFile(output, decompressed);
    }

    const out_stat = statSync(output);
    return JSON.stringify({ input, output, algorithm: algo, decompressed_size: out_stat.size }, null, 2);
  }

  private async compress_string(input: string, algo: string, level: number): Promise<string> {
    if (!input) return "Error: input is required";
    const buf = Buffer.from(input, "utf-8");
    if (algo === "brotli") {
      const compressed = await brotli_compress(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: level } });
      return compressed.toString("base64");
    }
    const { gzipSync } = await import("node:zlib");
    return gzipSync(buf, { level }).toString("base64");
  }

  private async decompress_string(input: string, algo: string): Promise<string> {
    if (!input) return "Error: input is required";
    const buf = Buffer.from(input, "base64");
    if (algo === "brotli") {
      const decompressed = await brotli_decompress(buf);
      return decompressed.toString("utf-8");
    }
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(buf).toString("utf-8");
  }
}
