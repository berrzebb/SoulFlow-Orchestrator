/** 에이전트 이벤트를 블록 단위로 누적하고 채널용 텍스트로 렌더링. */

import type { AgentEvent } from "../agent/agent.types.js";
import type { RenderMode } from "./rendering.js";

const fmt_num = (n: number) => n.toLocaleString("en-US");

type Fmt = {
  thinking: (tokens: number) => string;
  tool: (name: string, preview: string, is_error: boolean) => string;
  usage: (input: number, output: number, cost: string) => string;
  rate_warning: () => string;
  rate_rejected: () => string;
  compact: (pre_tokens: number) => string;
};

const FORMATTERS: Record<RenderMode, Fmt> = {
  markdown: {
    thinking: (n) => `💭 _(${fmt_num(n)} tokens)_`,
    tool: (name, preview, err) => `🔧 *${name}* ${err ? "❌" : "✅"}\n→ ${preview || "(no output)"}`,
    usage: (i, o, cost) => `📊 in: ${fmt_num(i)} / out: ${fmt_num(o)}${cost}`,
    rate_warning: () => "⚠️ _속도 제한 경고_",
    rate_rejected: () => "🚫 _속도 제한 초과 — 재시도 대기 중_",
    compact: (n) => `🗜️ _컨텍스트 압축 (${fmt_num(n)} tokens)_`,
  },
  html: {
    thinking: (n) => `💭 <i>(${fmt_num(n)} tokens)</i>`,
    tool: (name, preview, err) => `🔧 <b>${name}</b> ${err ? "❌" : "✅"}\n→ ${preview || "(no output)"}`,
    usage: (i, o, cost) => `📊 in: ${fmt_num(i)} / out: ${fmt_num(o)}${cost}`,
    rate_warning: () => "⚠️ <i>속도 제한 경고</i>",
    rate_rejected: () => "🚫 <i>속도 제한 초과 — 재시도 대기 중</i>",
    compact: (n) => `🗜️ <i>컨텍스트 압축 (${fmt_num(n)} tokens)</i>`,
  },
  plain: {
    thinking: (n) => `[Thinking: ${fmt_num(n)} tokens]`,
    tool: (name, preview, err) => `[${err ? "FAIL" : "OK"}] ${name}: ${preview || "(no output)"}`,
    usage: (i, o, cost) => `[Usage] in: ${fmt_num(i)} / out: ${fmt_num(o)}${cost}`,
    rate_warning: () => "[Rate limit warning]",
    rate_rejected: () => "[Rate limit exceeded]",
    compact: (n) => `[Context compacted: ${fmt_num(n)} tokens]`,
  },
};

/** tool_use + tool_result를 하나로 합친 완성 블록. */
type ToolBlock = {
  tool_id: string;
  name: string;
  params: Record<string, unknown>;
  result: string;
  is_error: boolean;
};

type SystemBlock =
  | { kind: "usage"; input: number; output: number; cost_usd?: number | null }
  | { kind: "rate_limit"; status: string }
  | { kind: "compact"; pre_tokens: number };

/** thinking이 있을 때만 생성 (optional). */
type ThinkingBlock = { tokens: number; preview: string };

export class ChannelBlockRenderer {
  private readonly thinking: ThinkingBlock[] = [];
  private readonly pending_tools = new Map<string, { name: string; params: Record<string, unknown> }>();
  private readonly completed_tools: ToolBlock[] = [];
  private readonly system: SystemBlock[] = [];

  /**
   * 이벤트를 받아 상태를 갱신한다.
   * 블록이 완성된 경우 true를 반환 → 호출자가 편집 스케줄링 판단.
   */
  push(event: AgentEvent): boolean {
    switch (event.type) {
      case "tool_use":
        this.pending_tools.set(event.tool_id, { name: event.tool_name, params: event.params });
        return false; // tool_result가 와야 블록 완성

      case "tool_result": {
        const pending = this.pending_tools.get(event.tool_id);
        this.pending_tools.delete(event.tool_id);
        this.completed_tools.push({
          tool_id: event.tool_id,
          name: pending?.name ?? event.tool_name,
          params: pending?.params ?? {},
          result: event.result,
          is_error: event.is_error ?? false,
        });
        return true; // use + result 합쳐서 블록 완성

      }
      case "usage":
        this.system.push({ kind: "usage", input: event.tokens.input, output: event.tokens.output, cost_usd: event.cost_usd });
        return true;

      case "rate_limit":
        if (event.status !== "allowed") {
          this.system.push({ kind: "rate_limit", status: event.status });
          return true;
        }
        return false;

      case "compact_boundary":
        this.system.push({ kind: "compact", pre_tokens: event.pre_tokens });
        return true;
    }
    return false;
  }

  /** thinking 블록 추가 (백엔드가 지원할 때만 호출). */
  push_thinking(tokens: number, content: string): void {
    this.thinking.push({ tokens, preview: content.slice(0, 120) });
  }

  has_content(): boolean {
    return this.thinking.length > 0 || this.completed_tools.length > 0 || this.system.length > 0;
  }

  /** 완성된 블록 전체를 채널용 텍스트로 렌더링. 도구가 2개 이상이면 헤더+목록 집약 포맷. */
  render(mode: RenderMode = "plain"): string {
    const parts: string[] = [];
    const fmt = FORMATTERS[mode] ?? FORMATTERS.plain;

    for (const t of this.thinking) {
      parts.push(fmt.thinking(t.tokens));
    }

    if (this.completed_tools.length > 0) {
      parts.push(this._render_tools(mode, fmt));
    }

    if (this.system.length > 0) {
      const lines: string[] = [];
      for (const s of this.system) {
        if (s.kind === "usage") {
          const cost = s.cost_usd !== null && s.cost_usd !== undefined ? ` ($${s.cost_usd.toFixed(4)})` : "";
          lines.push(fmt.usage(s.input, s.output, cost));
        } else if (s.kind === "rate_limit") {
          lines.push(s.status === "rejected" ? fmt.rate_rejected() : fmt.rate_warning());
        } else {
          lines.push(fmt.compact(s.pre_tokens));
        }
      }
      parts.push(lines.join("\n"));
    }

    return parts.join("\n\n");
  }

  private _render_tools(mode: RenderMode, fmt: Fmt): string {
    const tools = this.completed_tools;
    if (tools.length === 1) {
      const t = tools[0];
      const preview = t.result.replace(/\n+/g, " ").trim().slice(0, 120);
      return fmt.tool(t.name, preview, t.is_error);
    }
    // 2개 이상: 헤더 + 목록 집약
    const err_count = tools.filter((t) => t.is_error).length;
    const header_icon = err_count > 0 ? "⚠️" : "🔧";
    const header_suffix = err_count > 0 ? ` (${err_count}개 실패)` : "";
    const lines = tools.map((t) => {
      const status = t.is_error ? "❌" : "✅";
      const preview = t.result.replace(/\n+/g, " ").trim().slice(0, 80);
      const out = preview || "(no output)";
      if (mode === "html")     return `  <b>${t.name}</b> ${status} · ${out}`;
      if (mode === "markdown") return `  *${t.name}* ${status} · ${out}`;
      return `  ${t.name} [${t.is_error ? "FAIL" : "OK"}] ${out}`;
    });
    if (mode === "html")     return `${header_icon} <b>${tools.length}개 도구 사용</b>${header_suffix}\n${lines.join("\n")}`;
    if (mode === "markdown") return `${header_icon} *${tools.length}개 도구 사용*${header_suffix}\n${lines.join("\n")}`;
    return `${header_icon} ${tools.length} tools used${header_suffix}\n${lines.join("\n")}`;
  }
}
