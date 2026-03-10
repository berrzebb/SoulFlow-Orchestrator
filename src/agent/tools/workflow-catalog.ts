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
    "## Workflow Definition — Two Styles",
    "",
    "### Style A: Phase-based (multi-agent + critic + closed-loop)",
    "Use when you need parallel agents, quality gates, or closed-loop feedback.",
    "```",
    "{",
    '  title: string,',
    '  objective?: string,',
    '  phases: [{',
    '    phase_id: string,          // unique id (e.g. "research")',
    '    title: string,             // display name',
    '    mode?: "parallel"          // default: all agents run in parallel',
    '          | "sequential_loop"  // agents run one by one, looping until loop_until',
    '          | "interactive",     // interactive HITL loop',
    '    agents: [{',
    '      agent_id: string,',
    '      role: string,            // role identifier',
    '      label: string,           // display name',
    '      backend: string,         // provider instance_id',
    '      model?: string,',
    '      system_prompt: string,',
    '      tools?: string[],',
    '      max_turns?: number,      // default 3',
    '      filesystem_isolation?: "none" | "directory" | "worktree",',
    '    }],',
    '    critic?: {                 // optional quality gate',
    '      backend: string,',
    '      model?: string,',
    '      system_prompt: string,   // evaluation criteria',
    '      gate: boolean,           // true = blocks progress on rejection',
    '      on_rejection?:',
    '        "escalate"             // default: pause → waiting_user_input',
    '        | "retry_all"          // re-run ALL agents with critic feedback',
    '        | "retry_targeted"     // re-run only agents critic flagged',
    '        | "goto",              // ← CLOSED-LOOP: jump back to a specific phase',
    '      goto_phase?: string,     // required when on_rejection="goto": target phase_id',
    '      max_retries?: number,    // max goto/retry attempts before escalating (default 1)',
    '    },',
    '    failure_policy?: "best_effort" | "fail_fast" | "quorum",',
    '    quorum_count?: number,     // required when failure_policy="quorum"',
    '    loop_until?: string,       // JS expression for sequential_loop termination',
    '    max_loop_iterations?: number,',
    '    context_template?: string, // template for passing prev phase output',
    '    depends_on?: string[],     // phase_ids this phase depends on',
    '  }],',
    "}",
    "```",
    "",
    "### Closed-Loop Pattern (critic → goto → retry)",
    "When a critic rejects output, `on_rejection: goto` jumps back to an earlier phase,",
    "re-runs all intermediate phases, and the critic evaluates again. This repeats up to",
    "`max_retries` times before escalating to the user. Use this for self-improving workflows.",
    "```",
    "phases:",
    '  - phase_id: "draft"',
    '    agents: [{ agent_id: "writer", ... }]',
    '  - phase_id: "review"',
    '    agents: [{ agent_id: "reviewer", ... }]',
    '    critic:',
    '      gate: true',
    '      on_rejection: goto',
    '      goto_phase: "draft"    # ← loop back to draft phase on rejection',
    '      max_retries: 2         # ← allow up to 2 re-drafts before escalating',
    '      system_prompt: "Score the draft 1-10. Reject if score < 8."',
    "```",
    "",
    "### Style B: Orchestration node DAG",
    "Use when you need branching, data transforms, HTTP calls, or complex control flow.",
    "```",
    "{",
    '  title: string,',
    '  objective?: string,',
    '  orche_nodes: [{',
    '    node_id: string,        // unique id (e.g. "fetch-1")',
    '    node_type: string,      // one of the types listed above',
    '    title: string,',
    '    depends_on?: string[],',
    '    preset_id?: string,',
    '    ...params               // type-specific parameters',
    '  }],',
    '  trigger_nodes?: [{',
    '    id: string,',
    '    trigger_type: "cron" | "webhook" | "manual" | "channel_message" | "kanban_event",',
    '    // cron: schedule, timezone',
    '    // webhook: webhook_path',
    '    // channel_message: channel_type, chat_id',
    '    // kanban_event: board_id, actions[], column_id',
    '  }],',
    '  end_nodes?: [{',
    '    node_id: string,',
    '    output_targets: string[],',
    '    target_config?: Record<string, Record<string, unknown>>',
    '  }]',
    "}",
    "```",
  ].join("\n");
}
