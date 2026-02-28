import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "./types.js";
import { is_local_reference, resolve_local_reference } from "../utils/local-ref.js";

type ProviderTokens = {
  slack_bot_token?: string;
  telegram_bot_token?: string;
  telegram_api_base?: string;
};

export type MediaCollectorOptions = {
  workspace_dir: string;
  tokens: ProviderTokens;
};

const FILE_EXTENSION_RE = /\.(txt|md|csv|json|xml|yaml|yml|pdf|log|zip|tar|gz|png|jpg|jpeg|webp|gif|mp3|wav|ogg|mp4|mov|webm)(?:$|\?)/i;
const MAX_REMOTE_FILE_SIZE = 20 * 1024 * 1024;

export class MediaCollector {
  private readonly workspace_dir: string;
  private readonly tokens: ProviderTokens;

  constructor(options: MediaCollectorOptions) {
    this.workspace_dir = options.workspace_dir;
    this.tokens = options.tokens;
  }

  async collect(provider: ChannelProvider, message: InboundMessage): Promise<string[]> {
    const paths = new UniqueList();

    for (const m of Array.isArray(message.media) ? message.media : []) {
      if (!m?.url) continue;
      const url = String(m.url || "").trim();
      if (is_local_reference(url)) paths.push(resolve_local_reference(this.workspace_dir, url));
    }

    await this.collect_provider_files(provider, message, paths);
    await this.collect_linked_files(provider, String(message.content || ""), paths);
    return paths.values().slice(0, 8);
  }

  private async collect_provider_files(provider: ChannelProvider, message: InboundMessage, paths: UniqueList): Promise<void> {
    const meta = message_meta(message);

    if (provider === "slack") {
      for (const f of extract_slack_files(meta)) {
        const saved = await this.download_with_auth(f.url, f.name, "slack", this.tokens.slack_bot_token);
        if (saved) paths.push(saved);
      }
    } else if (provider === "telegram") {
      for (const id of extract_telegram_file_ids(meta)) {
        const saved = await this.download_telegram_file(id);
        if (saved) paths.push(saved);
      }
    } else if (provider === "discord") {
      for (const f of extract_discord_files(meta)) {
        const saved = await this.download_file(f.url, f.name, "discord");
        if (saved) paths.push(saved);
      }
    }
  }

  private async collect_linked_files(provider: ChannelProvider, text: string, paths: UniqueList): Promise<void> {
    for (const url of extract_file_links(text)) {
      const saved = await this.download_file(url, undefined, provider, MAX_REMOTE_FILE_SIZE);
      if (saved) paths.push(saved);
    }
  }

  private async download_with_auth(url: string, hint_name: string | undefined, sub_dir: string, token?: string): Promise<string | null> {
    if (!url || !token) return null;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return this.save_response(res, url, hint_name, sub_dir);
    } catch { return null; }
  }

  private async download_file(url: string, hint_name: string | undefined, sub_dir: string, max_size?: number): Promise<string | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      if (max_size) {
        const cl = Number(res.headers.get("content-length") || 0);
        if (cl > max_size) return null;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (max_size && (bytes.byteLength <= 0 || bytes.byteLength > max_size)) return null;
      const name = safe_filename(hint_name || url_basename(url));
      const dir = await this.ensure_dir(sub_dir);
      const path = join(dir, `${Date.now()}-${name}`);
      await writeFile(path, bytes);
      return path;
    } catch { return null; }
  }

  private async download_telegram_file(file_id: string): Promise<string | null> {
    const token = this.tokens.telegram_bot_token;
    const api_base = this.tokens.telegram_api_base || "https://api.telegram.org";
    if (!token || !file_id) return null;
    try {
      const info_res = await fetch(`${api_base}/bot${token}/getFile?file_id=${encodeURIComponent(file_id)}`);
      const info = (await info_res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!info_res.ok || info.ok !== true) return null;
      const result = (info.result && typeof info.result === "object") ? info.result as Record<string, unknown> : null;
      const file_path = String(result?.file_path || "").trim();
      if (!file_path) return null;
      const file_res = await fetch(`${api_base}/file/bot${token}/${file_path}`);
      if (!file_res.ok) return null;
      return this.save_response(file_res, file_path, undefined, "telegram");
    } catch { return null; }
  }

  private async save_response(res: Response, source_path: string, hint_name: string | undefined, sub_dir: string): Promise<string> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = safe_filename(hint_name || url_basename(source_path));
    const dir = await this.ensure_dir(sub_dir);
    const path = join(dir, `${Date.now()}-${name}`);
    await writeFile(path, bytes);
    return path;
  }

  private async ensure_dir(sub_dir: string): Promise<string> {
    const dir = join(this.workspace_dir, "runtime", "inbound-files", sub_dir);
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

class UniqueList {
  private readonly set = new Set<string>();
  private readonly list: string[] = [];

  push(value: string): void {
    const trimmed = value.trim();
    if (!trimmed || this.set.has(trimmed)) return;
    this.set.add(trimmed);
    this.list.push(trimmed);
  }

  values(): string[] { return this.list; }
}

function message_meta(msg: InboundMessage): Record<string, unknown> {
  return (msg.metadata && typeof msg.metadata === "object") ? msg.metadata as Record<string, unknown> : {};
}

function sub_object(parent: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = parent[key];
  return (v && typeof v === "object") ? v as Record<string, unknown> : null;
}

function extract_slack_files(meta: Record<string, unknown>): Array<{ url: string; name?: string }> {
  const slack = sub_object(meta, "slack");
  if (!slack) return [];
  const files = Array.isArray(slack.files) ? slack.files as Array<Record<string, unknown>> : [];
  return files
    .map((f) => ({ url: String(f.url_private_download || f.url_private || "").trim(), name: String(f.name || "").trim() || undefined }))
    .filter((f) => Boolean(f.url));
}

function extract_telegram_file_ids(meta: Record<string, unknown>): string[] {
  const tg = sub_object(meta, "telegram");
  if (!tg) return [];
  const ids: string[] = [];
  const push_id = (obj: Record<string, unknown> | null) => { if (obj?.file_id) ids.push(String(obj.file_id)); };
  push_id(sub_object(tg, "document"));
  push_id(sub_object(tg, "video"));
  push_id(sub_object(tg, "audio"));
  const photo = Array.isArray(tg.photo) ? tg.photo as Array<Record<string, unknown>> : [];
  if (photo.length > 0) push_id(photo[photo.length - 1] as Record<string, unknown>);
  return [...new Set(ids)];
}

function extract_discord_files(meta: Record<string, unknown>): Array<{ url: string; name?: string }> {
  const discord = sub_object(meta, "discord");
  if (!discord) return [];
  const attachments = Array.isArray(discord.attachments) ? discord.attachments as Array<Record<string, unknown>> : [];
  return attachments
    .map((a) => ({ url: String(a.url || a.proxy_url || "").trim(), name: String(a.filename || "").trim() || undefined }))
    .filter((f) => Boolean(f.url));
}

function extract_file_links(text: string): string[] {
  const matches = String(text || "").match(/https?:\/\/[^\s<>()]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    try { if (!FILE_EXTENSION_RE.test(new URL(url).pathname)) continue; } catch { continue; }
    seen.add(url);
    out.push(url);
    if (out.length >= 6) break;
  }
  return out;
}

function url_basename(url_or_path: string): string {
  try { return basename(new URL(url_or_path).pathname) || "file.bin"; }
  catch { return basename(url_or_path) || "file.bin"; }
}

function safe_filename(name: string): string {
  return (name || "file.bin").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
}
