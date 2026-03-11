/** 문서 생성 도구 — PDF/DOCX/XLSX/PPTX 생성 (텍스트/마크다운 입력). */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as fontkitModule from "@pdf-lib/fontkit";
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType } from "docx";
import ExcelJS from "exceljs";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");

export class DocumentTool extends Tool {
  readonly name = "document";
  readonly category = "data" as const;
  readonly description = "Create PDF/DOCX/XLSX/PPTX documents from text/markdown content.";
  readonly policy_flags = { write: true } as const;
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create_pdf", "create_docx", "create_xlsx", "create_pptx"], description: "Document operation" },
      content: { type: "string", description: "Content to generate" },
      input_format: { type: "string", enum: ["text", "markdown", "html"], description: "Input format (default: markdown)" },
      output: { type: "string", description: "Output filename (workspace relative)" },
      delimiter: { type: "string", description: "CSV delimiter for create_xlsx (default: ',')" },
      slide_format: { type: "string", enum: ["16:9", "4:3"], description: "Slide format for create_pptx (default: '16:9')" },
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
    const action = String(params.action || "");

    switch (action) {
      case "create_pdf":
        return this.create_pdf(params);
      case "create_docx":
        return this.create_docx(params);
      case "create_xlsx":
        return this.create_xlsx(params);
      case "create_pptx":
        return this.create_pptx(params);
      default:
        return `Error: unknown action "${action}"`;
    }
  }

  /** 텍스트/마크다운 → PDF 생성 (pdf-lib 사용). */
  private async create_pdf(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content || "").trim();
    if (!content) return "Error: content is required";

    const output = String(params.output || "").trim();
    if (!output) return "Error: output filename is required";

    const format = String(params.input_format || "markdown").toLowerCase();
    const abs = resolve(this.workspace, output);

    if (!abs.startsWith(resolve(this.workspace))) {
      return "Error: path traversal blocked";
    }

    try {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkitModule.default);

      const fontName = StandardFonts.Helvetica;
      const font = await pdfDoc.embedFont(fontName);
      const fontSize = 12;
      const pageHeight = 792;
      const pageWidth = 612;
      const margin = 50;
      const _maxWidth = pageWidth - 2 * margin;
      const lineHeight = fontSize * 1.5;

      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let currentY = pageHeight - margin;

      // 간단한 마크다운 파싱
      const lines = format === "markdown"
        ? this.parse_markdown(content)
        : content.split("\n");

      for (const line of lines) {
        const lineObj = this.parse_line(line);
        const fontSize_adj = lineObj.heading ? 16 + (3 - lineObj.level) * 2 : 12;
        const _isBold = !!lineObj.heading;

        if (currentY - lineHeight < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          currentY = pageHeight - margin;
        }

        page.drawText(lineObj.text, {
          x: margin,
          y: currentY,
          size: fontSize_adj,
          font,
          color: rgb(0, 0, 0),
        });

        currentY -= lineHeight * (fontSize_adj / 12);
      }

      const pdfBytes = await pdfDoc.save();
      await mkdir(resolve(this.workspace), { recursive: true });
      await writeFile(abs, pdfBytes);

      return JSON.stringify({
        output,
        size_bytes: pdfBytes.length,
        success: true,
      });
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  /** 텍스트/마크다운 → DOCX 생성 (docx npm 사용). */
  private async create_docx(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content || "").trim();
    if (!content) return "Error: content is required";

    const output = String(params.output || "").trim();
    if (!output) return "Error: output filename is required";

    const format = String(params.input_format || "markdown").toLowerCase();
    const abs = resolve(this.workspace, output);

    if (!abs.startsWith(resolve(this.workspace))) {
      return "Error: path traversal blocked";
    }

    try {
      const lines = format === "markdown"
        ? this.parse_markdown(content)
        : content.split("\n");

      const sections = lines.map((line) => {
        const lineObj = this.parse_line(line);
        if (lineObj.heading) {
          return new Paragraph({
            text: lineObj.text,
            heading: HeadingLevel[`HEADING_${lineObj.level}` as keyof typeof HeadingLevel] || HeadingLevel.HEADING_1,
          });
        }
        return new Paragraph({
          text: lineObj.text,
          alignment: AlignmentType.LEFT,
        });
      });

      const doc = new Document({
        sections: [
          {
            children: sections,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      await mkdir(resolve(this.workspace), { recursive: true });
      await writeFile(abs, buffer);

      return JSON.stringify({
        output,
        size_bytes: buffer.length,
        success: true,
      });
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }


  /** 텍스트/마크다운 → XLSX 생성 (xlsx 사용). */
  private async create_xlsx(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content || "").trim();
    if (!content) return "Error: content is required";

    const output = String(params.output || "").trim();
    if (!output) return "Error: output filename is required";

    const delimiter = String(params.delimiter || ",");
    const abs = resolve(this.workspace, output);

    if (!abs.startsWith(resolve(this.workspace))) {
      return "Error: path traversal blocked";
    }

    try {
      const lines = content.split("\n");
      const data: string[][] = [];

      // 마크다운 테이블 감지
      if (lines.length > 0 && lines[0].includes("|")) {
        for (const line of lines) {
          if (line.trim().startsWith("|")) {
            const cells = line.split("|").map(cell => cell.trim()).filter(c => c.length > 0 && !c.match(/^-+$/));
            if (cells.length > 0) data.push(cells);
          }
        }
      } else {
        // CSV 스타일 파싱
        for (const line of lines) {
          if (line.trim()) {
            const cells = line.split(delimiter).map(c => c.trim());
            data.push(cells);
          }
        }
      }

      if (data.length === 0) {
        return "Error: no data to create spreadsheet";
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Sheet1");
      ws.addRows(data);

      await mkdir(resolve(this.workspace), { recursive: true });
      const buffer = await wb.xlsx.writeBuffer();
      await writeFile(abs, Buffer.from(buffer));

      return JSON.stringify({
        output,
        size_bytes: buffer.byteLength,
        success: true,
      });
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  /** 마크다운 → PPTX 생성 (pptxgenjs 사용). */
  private async create_pptx(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content || "").trim();
    if (!content) return "Error: content is required";

    const output = String(params.output || "").trim();
    if (!output) return "Error: output filename is required";

    const slideFormat = String(params.slide_format || "16:9");
    const abs = resolve(this.workspace, output);

    if (!abs.startsWith(resolve(this.workspace))) {
      return "Error: path traversal blocked";
    }

    try {
      const prs = new PptxGenJS();
      prs.defineLayout({ name: slideFormat, width: slideFormat === "16:9" ? 10 : 7.5, height: slideFormat === "16:9" ? 5.625 : 5.625 });

      // `---`로 슬라이드 구분
      const slides = content.split(/\n---\n/).map(s => s.trim());

      for (const slideContent of slides) {
        const slide = prs.addSlide();
        const lines = slideContent.split("\n").filter(l => l.trim());

        let titleSet = false;
        const bodyLines: string[] = [];

        for (const line of lines) {
          if (!titleSet && line.startsWith("# ")) {
            slide.addText(line.replace(/^#+\s+/, ""), {
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 1,
              fontSize: 44,
              bold: true,
            });
            titleSet = true;
          } else {
            bodyLines.push(line.replace(/^[-*]\s+/, ""));
          }
        }

        if (bodyLines.length > 0) {
          slide.addText(bodyLines.join("\n"), {
            x: 0.5,
            y: 1.7,
            w: 9,
            h: 3.5,
            fontSize: 18,
            align: "left",
          });
        }
      }

      await mkdir(resolve(this.workspace), { recursive: true });
      await prs.writeFile({ fileName: abs });

      // 파일 크기 확인
      const { stat } = await import("node:fs/promises");
      const fileStats = await stat(abs);

      return JSON.stringify({
        output,
        size_bytes: fileStats.size,
        success: true,
      });
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  /** 간단한 마크다운 파싱 (헤딩 + 텍스트). */
  private parse_markdown(content: string): string[] {
    return content.split("\n");
  }

  /** 한 줄 파싱 (헤딩 레벨 + 텍스트). */
  private parse_line(line: string): { heading: boolean; level: number; text: string } {
    const match = line.match(/^(#+)\s+(.*)$/);
    if (match) {
      return {
        heading: true,
        level: match[1].length,
        text: match[2],
      };
    }
    return { heading: false, level: 1, text: line };
  }
}
