/** vCard 도구 — vCard 3.0/4.0 생성/파싱. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class VcardTool extends Tool {
  readonly name = "vcard";
  readonly category = "data" as const;
  readonly description = "vCard utilities: generate, parse, validate, to_json, from_json.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "parse", "validate", "to_json", "from_json"], description: "Operation" },
      name: { type: "string", description: "Full name" },
      email: { type: "string", description: "Email address" },
      phone: { type: "string", description: "Phone number" },
      org: { type: "string", description: "Organization" },
      title: { type: "string", description: "Job title" },
      url: { type: "string", description: "Website URL" },
      address: { type: "string", description: "Street address" },
      note: { type: "string", description: "Note" },
      vcard: { type: "string", description: "vCard string (parse/validate)" },
      data: { type: "string", description: "JSON data (from_json)" },
      version: { type: "string", description: "vCard version (3.0 or 4.0, default: 4.0)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");

    switch (action) {
      case "generate": {
        const ver = String(params.version || "4.0");
        const name = String(params.name || "");
        const parts = name.split(" ");
        const family = parts.length > 1 ? parts.slice(-1)[0] : name;
        const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
        const lines = [
          "BEGIN:VCARD",
          `VERSION:${ver}`,
          `FN:${name}`,
          `N:${family};${given};;;`,
        ];
        if (params.email) lines.push(`EMAIL:${params.email}`);
        if (params.phone) lines.push(`TEL:${params.phone}`);
        if (params.org) lines.push(`ORG:${params.org}`);
        if (params.title) lines.push(`TITLE:${params.title}`);
        if (params.url) lines.push(`URL:${params.url}`);
        if (params.address) lines.push(`ADR:;;${params.address};;;;`);
        if (params.note) lines.push(`NOTE:${params.note}`);
        lines.push("END:VCARD");
        return lines.join("\r\n");
      }
      case "parse":
      case "to_json": {
        const vcard = String(params.vcard || "");
        return JSON.stringify(this.parse_vcard(vcard));
      }
      case "validate": {
        const vcard = String(params.vcard || "");
        const errors: string[] = [];
        if (!vcard.includes("BEGIN:VCARD")) errors.push("missing BEGIN:VCARD");
        if (!vcard.includes("END:VCARD")) errors.push("missing END:VCARD");
        if (!vcard.includes("FN:") && !vcard.includes("FN;")) errors.push("missing FN (full name)");
        if (!vcard.includes("VERSION:")) errors.push("missing VERSION");
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      case "from_json": {
        let data: Record<string, unknown>;
        try { data = JSON.parse(String(params.data || "{}")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const p: Record<string, unknown> = {
          action: "generate",
          name: data.name || data.fn || "",
          email: data.email,
          phone: data.phone || data.tel,
          org: data.org || data.organization,
          title: data.title,
          url: data.url,
          address: data.address || data.adr,
          note: data.note,
          version: data.version || "4.0",
        };
        return this.run(p);
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_vcard(vcard: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = vcard.replace(/\r\n /g, "").split(/\r?\n/);
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).split(";")[0].toUpperCase();
      const value = line.slice(colon + 1);
      switch (key) {
        case "FN": result.name = value; break;
        case "N": {
          const [family, given] = value.split(";");
          result.family_name = family;
          result.given_name = given;
          break;
        }
        case "EMAIL": result.email = value; break;
        case "TEL": result.phone = value; break;
        case "ORG": result.organization = value; break;
        case "TITLE": result.title = value; break;
        case "URL": result.url = value; break;
        case "ADR": result.address = value.split(";").filter(Boolean).join(", "); break;
        case "NOTE": result.note = value; break;
        case "VERSION": result.version = value; break;
      }
    }
    return result;
  }
}
