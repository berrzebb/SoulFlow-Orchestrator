/** 27개 노드 카탈로그 텍스트 생성 — 에이전트 시스템 프롬프트 주입용. */

import { get_all_handlers } from "../node-registry.js";
import { register_all_nodes } from "../nodes/index.js";

/** 등록된 모든 노드 핸들러를 기반으로 카탈로그 문자열을 생성. */
export function build_node_catalog(): string {
  register_all_nodes();
  const handlers = get_all_handlers();

  const lines = handlers.map((h) => {
    const inputs = h.input_schema.map((f) => `${f.name}: ${f.type}`).join(", ");
    const outputs = h.output_schema.map((f) => `${f.name}: ${f.type}`).join(", ");
    return `- ${h.node_type} [${h.icon}]: (${inputs}) → (${outputs})`;
  });

  return [
    `## Available Workflow Node Types (${handlers.length})`,
    "",
    ...lines,
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
    '    ...params               // type-specific parameters',
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
