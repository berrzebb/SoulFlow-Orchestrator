/** 노드 카탈로그 + 프리셋 텍스트 생성 — 에이전트 시스템 프롬프트 주입용. */

import type { NodeHandler } from "../node-registry.js";
import { get_all_handlers } from "../node-registry.js";
import { register_all_nodes } from "../nodes/index.js";
import { get_presets_for_type } from "../node-presets.js";

/** 노드 핸들러 카탈로그 문자열 생성. handlers 미전달 시 전체 노드 사용. */
export function build_node_catalog(handlers?: NodeHandler[]): string {
  register_all_nodes();
  if (!handlers) handlers = get_all_handlers();

  const lines = handlers.flatMap((h) => {
    const inputs = h.input_schema.map((f) => `${f.name}: ${f.type}`).join(", ");
    const outputs = h.output_schema.map((f) => `${f.name}: ${f.type}`).join(", ");
    const main = `- ${h.node_type} [${h.icon}]: (${inputs}) -> (${outputs})`;
    const presets = get_presets_for_type(h.node_type);
    if (!presets.length) return [main];
    const preset_lines = presets.map((p) => `    preset "${p.preset_id}": ${p.label} — ${p.description}`);
    return [main, ...preset_lines];
  });

  return [
    `## Available Workflow Node Types (${handlers.length})`,
    "",
    ...lines,
    "",
    "When using ai_agent or spawn_agent nodes, prefer preset configurations (e.g. preset_id: \"agent-researcher\") for common roles.",
    "The preset's defaults (system_prompt, max_turns, etc.) will be applied automatically.",
    "",
    "## Workflow Definition Structure",
    "```",
    "{",
    '  title: string,',
    '  objective?: string,',
    '  orche_nodes: [{',
    '    node_id: string,        // unique id (e.g. "fetch-1")',
    '    node_type: string,      // one of the types above',
    '    title: string,          // display name',
    '    depends_on?: string[],  // node_ids this depends on',
    '    preset_id?: string,     // optional preset (overrides default params)',
    '    ...params               // type-specific parameters (override preset)',
    '  }],',
    '  trigger_nodes?: [{',
    '    id: string,',
    '    trigger_type: "cron",',
    '    schedule: string,       // cron expression (e.g. "0 9 * * *")',
    '    timezone?: string       // e.g. "Asia/Seoul"',
    '  }]',
    "}",
    "```",
  ].join("\n");
}
