import { resolve } from "node:path";

export function normalize_local_candidate_path(path_value: string): string {
  let value = String(path_value || "").trim();
  if (!value) return "";

  const markdown_link = value.match(/^\[[^\]]*]\(([^)]+)\)$/);
  if (markdown_link) value = String(markdown_link[1] || "").trim();
  value = value
    .replace(/^[("'`<\s]+/, "")
    .replace(/[)"'`>\s,.;:!?]+$/, "")
    .trim();

  if (/^file:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "file:") {
        const decoded = decodeURIComponent(parsed.pathname || "");
        if (/^\/[A-Za-z]:\//.test(decoded)) {
          value = decoded.slice(1).replace(/\//g, "\\");
        } else {
          value = decoded;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (!value.startsWith("\\\\") && value.includes("\\\\")) {
    value = value.replace(/\\\\/g, "\\");
  }
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep original when decode fails
    }
  }
  return value.trim();
}

export function is_local_reference(path_value: string): boolean {
  const value = normalize_local_candidate_path(String(path_value || "").trim());
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\/.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  if (/^[^\\/:*?"<>|]+[\\/].+/.test(value)) return true;
  return false;
}

export function resolve_local_reference(workspace: string, path_value: string): string {
  const normalized = normalize_local_candidate_path(String(path_value || "").trim());
  if (!normalized) return "";
  return resolve(workspace, normalized);
}
