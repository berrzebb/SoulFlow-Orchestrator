/**
 * 훅 설정 로더 — HOOK.md 파일 및 설정 객체에서 HookDefinition을 파싱.
 *
 * HOOK.md 형식:
 * ```
 * ---
 * hooks:
 *   PreToolUse:
 *     - name: block-dangerous
 *       matcher: "exec|shell"
 *       handler:
 *         type: command
 *         command: "node scripts/check-tool.js"
 *         timeout_ms: 5000
 *   PostToolUse:
 *     - name: log-tool-use
 *       handler:
 *         type: http
 *         url: "http://localhost:9090/hooks/tool-log"
 *       async: true
 * ---
 * ```
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  HookDefinition,
  HookEventName,
  HookHandler,
  HooksConfig,
} from "./types.js";

const HOOK_EVENT_NAMES: ReadonlySet<string> = new Set<HookEventName>([
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "SessionStart", "SessionEnd", "Stop",
  "SubagentStart", "SubagentStop", "TaskCompleted", "Notification",
]);

/** HOOK.md 파일에서 YAML frontmatter를 추출. */
function extract_frontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

/**
 * 간이 YAML 파서 — 훅 설정 전용.
 * 외부 YAML 라이브러리 의존 없이 hooks 설정 구조만 파싱.
 */
function parse_hooks_yaml(yaml: string): HooksConfig {
  const result: HooksConfig = { hooks: {} };
  const lines = yaml.split(/\r?\n/);
  let current_event: HookEventName | null = null;
  let current_def: Partial<HookDefinition> | null = null;
  let current_handler: Partial<HookHandler> | null = null;
  let in_hooks = false;
  let in_handler = false;
  let in_headers = false;
  let current_headers: Record<string, string> = {};

  const flush_def = () => {
    if (current_def && current_event && current_def.name && current_def.handler) {
      if (in_headers && current_handler && current_handler.type === "http") {
        (current_handler as { headers?: Record<string, string> }).headers = { ...current_headers };
        current_headers = {};
        in_headers = false;
      }
      if (!result.hooks) result.hooks = {};
      if (!result.hooks[current_event]) result.hooks[current_event] = [];
      result.hooks[current_event]!.push(current_def as HookDefinition);
    }
    current_def = null;
    current_handler = null;
    in_handler = false;
    in_headers = false;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^hooks:\s*$/.test(trimmed)) { in_hooks = true; continue; }
    if (!in_hooks) continue;

    // 이벤트 이름 (2-space indent)
    const event_match = trimmed.match(/^  (\w+):\s*$/);
    if (event_match && HOOK_EVENT_NAMES.has(event_match[1])) {
      flush_def();
      current_event = event_match[1] as HookEventName;
      continue;
    }

    // 새 정의 시작 (4-space indent, list item)
    if (trimmed.match(/^    - /)) {
      flush_def();
      current_def = {};
      const name_match = trimmed.match(/^    - name:\s*"?([^"]*)"?\s*$/);
      if (name_match) current_def.name = name_match[1].trim();
      if (current_event) current_def.event = current_event;
      continue;
    }

    // 정의 속성 (6-space indent)
    if (current_def && trimmed.match(/^      \w/)) {
      const kv = trimmed.match(/^\s+(\w+):\s*(.+)$/);
      if (!kv) continue;
      const [, key, raw_val] = kv;
      const val = raw_val.replace(/^"(.*)"$/, "$1").trim();

      if (key === "name") { current_def.name = val; continue; }
      if (key === "matcher") { current_def.matcher = val; continue; }
      if (key === "async") { current_def.async = val === "true"; continue; }
      if (key === "disabled") { current_def.disabled = val === "true"; continue; }

      if (key === "handler") {
        in_handler = true;
        current_handler = {};
        continue;
      }

      if (in_handler && current_handler) {
        if (key === "type") {
          (current_handler as { type: string }).type = val as "command" | "http";
        } else if (key === "command") {
          (current_handler as { command?: string }).command = val;
        } else if (key === "url") {
          (current_handler as { url?: string }).url = val;
        } else if (key === "timeout_ms") {
          (current_handler as { timeout_ms?: number }).timeout_ms = Number(val) || undefined;
        } else if (key === "cwd") {
          (current_handler as { cwd?: string }).cwd = val;
        } else if (key === "headers") {
          in_headers = true;
          current_headers = {};
        }

        if (current_handler.type) {
          current_def.handler = current_handler as HookHandler;
        }
        continue;
      }
    }

    // headers 항목 (8-space indent)
    if (in_headers && trimmed.match(/^        /)) {
      const hdr = trimmed.match(/^\s+(\S+):\s*(.+)$/);
      if (hdr) current_headers[hdr[1]] = hdr[2].replace(/^"(.*)"$/, "$1").trim();
      continue;
    }

    // top-level 키 (indent 0-1) → hooks 블록 종료
    if (trimmed.length > 0 && !trimmed.startsWith(" ")) {
      flush_def();
      in_hooks = false;
    }
  }
  flush_def();
  return result;
}

/** HOOK.md 파일에서 훅 설정 로드. 없으면 빈 설정. */
export function load_hooks_from_file(workspace: string, filename = "HOOK.md"): HooksConfig {
  const path = join(workspace, filename);
  if (!existsSync(path)) return { hooks: {} };
  try {
    const content = readFileSync(path, "utf-8");
    const fm = extract_frontmatter(content);
    if (!fm) return { hooks: {} };
    return parse_hooks_yaml(fm);
  } catch {
    return { hooks: {} };
  }
}

/** 여러 소스의 HooksConfig를 병합. 같은 이벤트의 훅은 합산. */
export function merge_hooks_configs(...configs: (HooksConfig | null | undefined)[]): HooksConfig {
  const result: HooksConfig = { hooks: {} };
  for (const config of configs) {
    if (!config?.hooks) continue;
    for (const [event, defs] of Object.entries(config.hooks)) {
      const key = event as HookEventName;
      if (!result.hooks![key]) result.hooks![key] = [];
      result.hooks![key]!.push(...(defs as HookDefinition[]));
    }
  }
  return result;
}

/** 설정 객체(JSON 구조)에서 HooksConfig 변환. */
export function hooks_config_from_settings(
  raw: Record<string, unknown> | null | undefined,
): HooksConfig {
  if (!raw || typeof raw !== "object") return { hooks: {} };
  const hooks_raw = raw.hooks;
  if (!hooks_raw || typeof hooks_raw !== "object") return { hooks: {} };

  const result: HooksConfig = { hooks: {} };
  for (const [event, defs_raw] of Object.entries(hooks_raw as Record<string, unknown>)) {
    if (!HOOK_EVENT_NAMES.has(event) || !Array.isArray(defs_raw)) continue;
    const key = event as HookEventName;
    result.hooks![key] = defs_raw
      .filter((d): d is Record<string, unknown> => d !== null && typeof d === "object")
      .map((d) => ({
        name: String(d.name || "unnamed"),
        event: key,
        matcher: typeof d.matcher === "string" ? d.matcher : undefined,
        handler: d.handler as HookHandler,
        async: d.async === true,
        disabled: d.disabled === true,
      }));
  }
  return result;
}
