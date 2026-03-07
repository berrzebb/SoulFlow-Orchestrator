/** Image 도구 — 이미지 리사이즈, 크롭, 회전, 포맷 변환, 메타데이터 조회. ImageMagick 기반. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";

export class ImageTool extends Tool {
  readonly name = "image";
  readonly category = "filesystem" as const;
  readonly policy_flags = { write: true } as const;
  readonly description =
    "Image operations: resize, crop, rotate, convert format, get info/metadata. Uses ImageMagick.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["resize", "crop", "rotate", "convert", "info", "thumbnail"], description: "Image operation" },
      input_path: { type: "string", description: "Input image file path" },
      output_path: { type: "string", description: "Output file path (defaults to in-place for resize/rotate)" },
      width: { type: "integer", minimum: 1, maximum: 10000, description: "Target width in pixels" },
      height: { type: "integer", minimum: 1, maximum: 10000, description: "Target height in pixels" },
      angle: { type: "integer", description: "Rotation angle in degrees (for rotate)" },
      format: { type: "string", enum: ["png", "jpeg", "webp", "gif", "bmp", "tiff"], description: "Output format (for convert)" },
      quality: { type: "integer", minimum: 1, maximum: 100, description: "JPEG/WebP quality (default: 85)" },
      gravity: { type: "string", enum: ["center", "north", "south", "east", "west", "northwest", "northeast", "southwest", "southeast"], description: "Crop gravity" },
    },
    required: ["operation", "input_path"],
    additionalProperties: false,
  };

  private readonly workspace: string;
  constructor(opts: { workspace: string }) {
    super();
    this.workspace = opts.workspace;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "info");
    const input = String(params.input_path || "").trim();
    if (!input) return "Error: input_path is required";
    const output = String(params.output_path || "").trim();
    const quality = Number(params.quality || 85);

    try {
      switch (op) {
        case "info": return await this.get_info(input);
        case "resize": return await this.resize(input, output || input, params);
        case "crop": return await this.crop(input, output || input, params);
        case "rotate": return await this.rotate(input, output || input, Number(params.angle || 90));
        case "convert": return await this.convert_format(input, output, String(params.format || "png"), quality);
        case "thumbnail": return await this.thumbnail(input, output, params);
        default: return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async exec(command: string): Promise<string> {
    const { stdout, stderr } = await run_shell_command(command, {
      cwd: this.workspace,
      timeout_ms: 60_000,
      max_buffer_bytes: 1024 * 1024 * 4,
    });
    return [stdout || "", stderr || ""].join("\n").trim();
  }

  private q(s: string): string { return `"${s.replace(/"/g, '\\"')}"`; }

  private async get_info(input: string): Promise<string> {
    const out = await this.exec(`identify -verbose ${this.q(input)} 2>&1 | head -30`);
    return out || "Error: failed to get image info (is ImageMagick installed?)";
  }

  private async resize(input: string, output: string, params: Record<string, unknown>): Promise<string> {
    const w = Number(params.width || 0);
    const h = Number(params.height || 0);
    if (!w && !h) return "Error: width or height is required";
    const geometry = w && h ? `${w}x${h}` : w ? `${w}x` : `x${h}`;
    await this.exec(`convert ${this.q(input)} -resize ${geometry} ${this.q(output)}`);
    return `Resized to ${geometry} → ${output}`;
  }

  private async crop(input: string, output: string, params: Record<string, unknown>): Promise<string> {
    const w = Number(params.width || 0);
    const h = Number(params.height || 0);
    if (!w || !h) return "Error: width and height are required for crop";
    const gravity = String(params.gravity || "center");
    await this.exec(`convert ${this.q(input)} -gravity ${gravity} -crop ${w}x${h}+0+0 +repage ${this.q(output)}`);
    return `Cropped ${w}x${h} (${gravity}) → ${output}`;
  }

  private async rotate(input: string, output: string, angle: number): Promise<string> {
    await this.exec(`convert ${this.q(input)} -rotate ${angle} ${this.q(output)}`);
    return `Rotated ${angle}° → ${output}`;
  }

  private async convert_format(input: string, output: string, format: string, quality: number): Promise<string> {
    const out = output || input.replace(/\.\w+$/, `.${format}`);
    await this.exec(`convert ${this.q(input)} -quality ${quality} ${this.q(out)}`);
    return `Converted to ${format} (quality: ${quality}) → ${out}`;
  }

  private async thumbnail(input: string, output: string, params: Record<string, unknown>): Promise<string> {
    const size = Number(params.width || 150);
    const out = output || input.replace(/(\.\w+)$/, `-thumb$1`);
    await this.exec(`convert ${this.q(input)} -thumbnail ${size}x${size}^ -gravity center -extent ${size}x${size} ${this.q(out)}`);
    return `Thumbnail ${size}x${size} → ${out}`;
  }
}
