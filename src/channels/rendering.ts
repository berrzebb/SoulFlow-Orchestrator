import { sanitizeMarkdown } from "markdown-to-markdown-sanitizer";
import { escape_html } from "../utils/common.js";
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
  const input = normalize_html_to_markdown(String(raw || "").trim());
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

/** LLM이 HTML을 직접 생성한 경우 마크다운 등가물로 변환. 파이프라인은 항상 markdown 입력을 기대. */
function normalize_html_to_markdown(input: string): string {
  let out = String(input || "");
  if (!/<[a-z][a-z0-9]*[\s>]/i.test(out)) return out;
  out = out.replace(/<code>([^<]+)<\/code>/gi, "`$1`");
  out = out.replace(/<(?:b|strong)>([^<]+)<\/(?:b|strong)>/gi, "**$1**");
  out = out.replace(/<(?:i|em)>([^<]+)<\/(?:i|em)>/gi, "*$1*");
  out = out.replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, "[$2]($1)");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  out = out.replace(/<\/?(?:p|div|span)[^>]*>/gi, "");
  return out;
}

function normalize_response_template(raw: string): string {
  const input = String(raw || "").replace(/\r/g, "").trim();
  if (!input) return "";
  // secret resolution 전용 — 나머지는 LLM 응답을 그대로 통과
  return normalize_secret_resolution_template(input) || input;
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

function escape_html_attr(input: string): string {
  return escape_html(input).replace(/'/g, "&#39;");
}
