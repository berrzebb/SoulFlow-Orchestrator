import { sanitizeMarkdown } from "markdown-to-markdown-sanitizer";
import type { ChannelProvider } from "./types.js";

export type RenderMode = "markdown" | "html" | "plain";
export type BlockPolicy = "indicator" | "text-only" | "remove";

export type RenderProfile = {
  mode: RenderMode;
  blocked_link_policy: BlockPolicy;
  blocked_image_policy: BlockPolicy;
};

export type RenderedOutput = {
  markdown: string;
  content: string;
  parse_mode?: "HTML";
};

const DEFAULT_ORIGIN = "https://example.invalid";
const DEFAULT_LINK_PREFIXES = ["https:", "http:"] as const;
const DEFAULT_IMAGE_PREFIXES = ["https:", "http:"] as const;
const TEMPLATE_HEADER_RE = /^##\s*(요약|핵심|코드(?:\/|·)?명령|미디어)\b/im;
const BLOCKED_IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(\/forbidden\)/g;
const BLOCKED_LINK_MARKDOWN_RE = /\[([^\]]+)\]\(#\)/g;
const HEX_ENTITY_RE = /&([0-9a-f]{2,6});/gi;
const ESCAPED_MARKDOWN_PUNCT_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const INLINE_TOKEN_RE = /@@HTML_TOKEN_(\d+)@@/g;

export function default_render_profile(provider: ChannelProvider): RenderProfile {
  return {
    mode: provider === "telegram" ? "html" : "markdown",
    blocked_link_policy: "indicator",
    blocked_image_policy: "indicator",
  };
}

export function normalize_render_mode(value: unknown): RenderMode | null {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return null;
  if (token === "markdown" || token === "md" || token === "마크다운") return "markdown";
  if (token === "html") return "html";
  if (token === "plain" || token === "text" || token === "txt" || token === "텍스트") return "plain";
  return null;
}

export function normalize_block_policy(value: unknown): BlockPolicy | null {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return null;
  if (token === "indicator" || token === "표시") return "indicator";
  if (token === "text" || token === "text-only" || token === "text_only" || token === "텍스트") return "text-only";
  if (token === "remove" || token === "삭제" || token === "none") return "remove";
  return null;
}

export function render_agent_output(raw: string, profile: RenderProfile): RenderedOutput {
  const templated = normalize_response_template(String(raw || ""));
  const markdown = sanitize_markdown_output(templated, profile);
  if (!markdown) return { markdown: "", content: "" };
  if (profile.mode === "plain") return { markdown, content: markdown_to_plain(markdown) };
  if (profile.mode === "html") return { markdown, content: markdown_to_html(markdown), parse_mode: "HTML" };
  return { markdown, content: markdown };
}

function sanitize_markdown_output(raw: string, profile: RenderProfile): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  let sanitized = "";
  try {
    sanitized = sanitizeMarkdown(input, {
      defaultOrigin: DEFAULT_ORIGIN,
      defaultLinkOrigin: DEFAULT_ORIGIN,
      defaultImageOrigin: DEFAULT_ORIGIN,
      allowedLinkPrefixes: [...DEFAULT_LINK_PREFIXES],
      allowedImagePrefixes: [...DEFAULT_IMAGE_PREFIXES],
      maxMarkdownLength: 20_000,
      urlMaxLength: 500,
      sanitizeForCommonmark: true,
    }).trim();
  } catch {
    sanitized = input;
  }
  if (!sanitized) sanitized = input.slice(0, 8_000);
  sanitized = fix_blocked_email_links(sanitized);
  sanitized = apply_blocked_image_policy(sanitized, profile.blocked_image_policy);
  sanitized = apply_blocked_link_policy(sanitized, profile.blocked_link_policy);
  sanitized = rewrite_remote_markdown_images(sanitized);
  return collapse_blank_lines(sanitized).trim();
}

function normalize_response_template(raw: string): string {
  const input = String(raw || "").replace(/\r/g, "").trim();
  if (!input) return "";
  const secret_resolution_template = normalize_secret_resolution_template(input);
  if (secret_resolution_template) return secret_resolution_template;
  if (TEMPLATE_HEADER_RE.test(input)) return input;

  const has_code = /```[\s\S]*?```/.test(input);
  const has_media_hint = /!\[[^\]]*\]\(([^)]+)\)|\[(?:IMAGE|VIDEO|FILE)\s*:\s*([^\]]+)\]|<(?:img|video)[^>]*src=["']([^"']+)["']/i.test(input);
  const is_short_plain = input.length < 180 && input.split("\n").length <= 3 && !has_code && !has_media_hint;
  if (is_short_plain) return input;

  const media_refs = extract_media_refs(input);
  const code_blocks = extract_code_blocks(input);
  let body = input;
  for (const code of code_blocks) body = body.replace(code, "");
  body = strip_media_refs(body);
  body = collapse_blank_lines(body).trim();
  const body_lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = (body_lines[0] || input.split("\n")[0] || "").trim() || "(요약 없음)";
  const keypoints = extract_key_points(body_lines, summary);
  const code_section = code_blocks.length > 0 ? code_blocks.join("\n\n").trim() : "(없음)";
  const media_section = media_refs.length > 0
    ? media_refs.map((v) => `- ${v}`).join("\n")
    : "(없음)";
  const should_use_section_template = has_code || media_refs.length > 0 || body_lines.length >= 6;
  if (!should_use_section_template) {
    const compact = [
      summary,
      ...keypoints.slice(0, 3).map((v) => `- ${v}`),
    ].filter(Boolean);
    return compact.join("\n").trim();
  }

  const sections: string[] = [];
  sections.push("## 요약", summary);
  if (keypoints.length > 0) {
    sections.push("", "## 핵심", ...keypoints.map((v) => `- ${v}`));
  }
  if (code_blocks.length > 0) {
    sections.push("", "## 코드/명령", code_section);
  }
  if (media_refs.length > 0) {
    sections.push("", "## 미디어", media_section);
  }
  return sections.join("\n").trim();
}

function normalize_secret_resolution_template(raw: string): string | null {
  const input = String(raw || "").trim();
  if (!/^Error:\s*secret_resolution_required\b/i.test(input)) return null;
  const missing_line = input.match(/^missing_keys:\s*(.+)$/im);
  const invalid_line = input.match(/^invalid_ciphertexts:\s*(.+)$/im);
  const missing = String(missing_line?.[1] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 6);
  const invalid = String(invalid_line?.[1] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4);
  const bullets = [
    "- 복호화 상태: 차단됨 (안전 정책 적용)",
    missing.length > 0 ? `- 누락된 키: ${missing.join(", ")}` : "- 누락된 키: (없음)",
    invalid.length > 0 ? `- 무효 암호문: ${invalid.join(", ")}` : "- 무효 암호문: (없음)",
    "- 조치: /secret list -> /secret set <name> <value> -> {{secret:<name>}}로 재요청",
  ];
  return [
    "## 요약",
    "민감정보 키가 확인되지 않아 복호화를 수행하지 않았습니다.",
    "",
    "## 핵심",
    ...bullets,
    "",
    "## 코드/명령",
    "```text",
    "Error: secret_resolution_required",
    "```",
    "",
    "## 미디어",
    "(없음)",
  ].join("\n");
}

function extract_code_blocks(raw: string): string[] {
  const out: string[] = [];
  const text = String(raw || "");
  const re = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null = null;
  while (true) {
    m = re.exec(text);
    if (!m) break;
    const code = String(m[0] || "").trim();
    if (!code) continue;
    out.push(code);
    if (out.length >= 4) break;
  }
  return out;
}

function extract_media_refs(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  const source = String(raw || "");

  source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, altRaw, urlRaw) => {
    const alt = String(altRaw || "").trim();
    const url = String(urlRaw || "").trim();
    push(alt ? `[IMAGE: ${url}] ${alt}` : `[IMAGE: ${url}]`);
    return "";
  });
  source.replace(/\[(IMAGE|VIDEO|FILE)\s*:\s*([^\]]+)\]/gi, (_m, kindRaw, urlRaw) => {
    const kind = String(kindRaw || "").trim().toUpperCase();
    const url = String(urlRaw || "").trim();
    push(`${kind}: ${url}`);
    return "";
  });
  source.replace(/<(img|video)[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, tagRaw, urlRaw) => {
    const tag = String(tagRaw || "").trim().toLowerCase();
    const url = String(urlRaw || "").trim();
    if (tag === "video") push(`[VIDEO: ${url}]`);
    else push(`[IMAGE: ${url}]`);
    return "";
  });
  return out.slice(0, 8);
}

function strip_media_refs(raw: string): string {
  let text = String(raw || "");
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "");
  text = text.replace(/\[(IMAGE|VIDEO|FILE)\s*:\s*([^\]]+)\]/gi, "");
  text = text.replace(/<(?:img|video)[^>]*src=["']([^"']+)["'][^>]*>/gi, "");
  return text;
}

function extract_key_points(lines: string[], summary: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const text = String(value || "").replace(/^[-*]\s+/, "").trim();
    if (!text) return;
    if (text === summary) return;
    if (seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };

  for (const line of lines) {
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) push(line);
    if (out.length >= 4) return out;
  }

  const sentence_source = lines.join(" ");
  const chunks = sentence_source
    .split(/(?<=[.!?])\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
  for (const sentence of chunks) {
    push(sentence);
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}

function fix_blocked_email_links(markdown: string): string {
  return String(markdown || "").replace(BLOCKED_LINK_MARKDOWN_RE, (_match, labelRaw) => {
    const label = unescape_markdown_text(String(labelRaw || "")).trim();
    if (!EMAIL_RE.test(label)) return _match;
    return label;
  });
}

function apply_blocked_image_policy(markdown: string, policy: BlockPolicy): string {
  return String(markdown || "").replace(BLOCKED_IMAGE_MARKDOWN_RE, (_match, altRaw) => {
    const alt = unescape_markdown_text(String(altRaw || "")).trim();
    if (policy === "remove") return "";
    if (policy === "text-only") return alt || "image";
    if (alt) return `[image blocked: ${alt}]`;
    return "[image blocked]";
  });
}

function apply_blocked_link_policy(markdown: string, policy: BlockPolicy): string {
  return String(markdown || "").replace(BLOCKED_LINK_MARKDOWN_RE, (_match, labelRaw) => {
    const label = unescape_markdown_text(String(labelRaw || "")).trim();
    if (policy === "remove") return "";
    if (policy === "text-only") return label;
    return label ? `${label} [blocked-link]` : "[blocked-link]";
  });
}

function markdown_to_plain(markdown: string): string {
  let out = String(markdown || "");
  out = out.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_m, code) => String(code || "").trimEnd());
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, labelRaw, urlRaw) => {
    const label = unescape_markdown_text(String(labelRaw || "")).trim();
    const url = String(urlRaw || "").trim();
    if (!url || url === "#") return label;
    return `${label} (${url})`;
  });
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/^[-*]\s+/gm, "• ");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/_([^_]+)_/g, "$1");
  out = out.replace(/~~([^~]+)~~/g, "$1");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(ESCAPED_MARKDOWN_PUNCT_RE, "$1");
  return collapse_blank_lines(out).trim();
}

function markdown_to_html(markdown: string): string {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    if (/^```/.test(line.trim())) {
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${escape_html(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      out.push(`<b>${inline_markdown_to_html(String(heading[1] || ""))}</b>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      out.push(`• ${inline_markdown_to_html(String(bullet[1] || ""))}`);
      continue;
    }
    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      out.push(`${numbered[1]}. ${inline_markdown_to_html(String(numbered[2] || ""))}`);
      continue;
    }
    out.push(inline_markdown_to_html(trimmed));
  }

  if (inCode && codeLines.length > 0) {
    out.push(`<pre><code>${escape_html(codeLines.join("\n"))}</code></pre>`);
  }
  return collapse_blank_lines(out.join("\n")).trim();
}

function inline_markdown_to_html(text: string): string {
  const tokens: string[] = [];
  const hold = (html: string): string => {
    const idx = tokens.push(html) - 1;
    return `@@HTML_TOKEN_${idx}@@`;
  };
  let line = unescape_markdown_text(String(text || ""));

  line = line.replace(/`([^`]+)`/g, (_m, codeRaw) => hold(`<code>${escape_html(String(codeRaw || ""))}</code>`));

  line = line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, labelRaw, hrefRaw) => {
    const label = unescape_markdown_text(String(labelRaw || "")).trim();
    const href = normalize_href(String(hrefRaw || ""));
    if (!href) return label;
    return hold(`<a href="${escape_html_attr(href)}">${escape_html(label || href)}</a>`);
  });
  line = line.replace(/\bhttps?:\/\/[^\s<>()]+/g, (urlRaw) => {
    const href = normalize_href(String(urlRaw || ""));
    if (!href) return urlRaw;
    return hold(`<a href="${escape_html_attr(href)}">${escape_html(href)}</a>`);
  });

  line = line.replace(/\*\*([^*]+)\*\*/g, (_m, boldRaw) => hold(`<b>${escape_html(String(boldRaw || ""))}</b>`));
  line = line.replace(/\*([^*]+)\*/g, (_m, italicRaw) => hold(`<i>${escape_html(String(italicRaw || ""))}</i>`));

  const escaped = escape_html(line);
  return escaped.replace(INLINE_TOKEN_RE, (_m, idxRaw) => {
    const idx = Number(idxRaw || -1);
    return Number.isInteger(idx) && idx >= 0 && idx < tokens.length ? tokens[idx] : "";
  });
}

function normalize_href(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value || value === "#") return null;
  if (value.startsWith("#")) return value;
  try {
    const parsed = new URL(value, DEFAULT_ORIGIN);
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function rewrite_remote_markdown_images(markdown: string): string {
  return String(markdown || "").replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi, (_m, altRaw, urlRaw) => {
    const alt = unescape_markdown_text(String(altRaw || "")).trim();
    const href = normalize_href(String(urlRaw || ""));
    if (!href) return alt || String(urlRaw || "");
    if (alt) return `${alt}: ${href}`;
    return href;
  });
}

function unescape_markdown_text(input: string): string {
  const decoded = String(input || "").replace(HEX_ENTITY_RE, (_m, hexRaw) => {
    const code = Number.parseInt(String(hexRaw || ""), 16);
    if (!Number.isFinite(code)) return _m;
    if (code < 0 || code > 0x10ffff) return _m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return _m;
    }
  });
  return decoded.replace(ESCAPED_MARKDOWN_PUNCT_RE, "$1");
}

function collapse_blank_lines(input: string): string {
  return String(input || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n");
}

function escape_html(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escape_html_attr(input: string): string {
  return escape_html(input).replace(/'/g, "&#39;");
}
