/** StateMachine 도구 — 유한 상태 머신 정의/전이/검증/시각화. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface State { name: string; on?: Record<string, string>; }
interface MachineDefinition { initial: string; states: State[]; }

export class StateMachineTool extends Tool {
  readonly name = "state_machine";
  readonly category = "data" as const;
  readonly description = "Finite state machine: define, transition, validate, visualize, reachable, history.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["define", "transition", "validate", "visualize", "reachable", "history"], description: "Operation" },
      machine: { type: "string", description: "Machine definition JSON ({initial, states})" },
      current: { type: "string", description: "Current state name" },
      event: { type: "string", description: "Event to trigger transition" },
      events: { type: "string", description: "JSON array of events for history simulation" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "define");

    switch (action) {
      case "define": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        const state_names = def.states.map((s) => s.name);
        const all_events = new Set<string>();
        const transition_count = def.states.reduce((sum, s) => {
          if (s.on) Object.keys(s.on).forEach((e) => all_events.add(e));
          return sum + (s.on ? Object.keys(s.on).length : 0);
        }, 0);
        return JSON.stringify({
          initial: def.initial,
          state_count: state_names.length,
          states: state_names,
          event_count: all_events.size,
          events: [...all_events],
          transition_count,
        });
      }
      case "transition": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        const current = String(params.current || def.initial);
        const event = String(params.event || "");
        const state = def.states.find((s) => s.name === current);
        if (!state) return JSON.stringify({ error: `unknown state: ${current}` });
        const next = state.on?.[event];
        if (!next) return JSON.stringify({ error: `no transition for event '${event}' in state '${current}'`, available_events: state.on ? Object.keys(state.on) : [] });
        const next_state = def.states.find((s) => s.name === next);
        return JSON.stringify({
          from: current,
          event,
          to: next,
          available_events: next_state?.on ? Object.keys(next_state.on) : [],
        });
      }
      case "validate": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        const errors: string[] = [];
        const state_names = new Set(def.states.map((s) => s.name));
        if (!state_names.has(def.initial)) errors.push(`initial state '${def.initial}' not in states`);
        for (const s of def.states) {
          if (s.on) {
            for (const [evt, target] of Object.entries(s.on)) {
              if (!state_names.has(target)) errors.push(`state '${s.name}' event '${evt}' → unknown target '${target}'`);
            }
          }
        }
        const dead_ends = def.states.filter((s) => !s.on || Object.keys(s.on).length === 0).map((s) => s.name);
        const unreachable = this.find_unreachable(def);
        return JSON.stringify({
          valid: errors.length === 0,
          errors,
          warnings: {
            dead_end_states: dead_ends,
            unreachable_states: unreachable,
          },
        });
      }
      case "visualize": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        const lines: string[] = ["stateDiagram-v2"];
        lines.push(`  [*] --> ${def.initial}`);
        for (const s of def.states) {
          if (s.on) {
            for (const [evt, target] of Object.entries(s.on)) {
              lines.push(`  ${s.name} --> ${target}: ${evt}`);
            }
          }
        }
        return JSON.stringify({ format: "mermaid", diagram: lines.join("\n") });
      }
      case "reachable": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        const from = String(params.current || def.initial);
        const visited = new Set<string>();
        const queue = [from];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          const state = def.states.find((s) => s.name === cur);
          if (state?.on) {
            for (const target of Object.values(state.on)) {
              if (!visited.has(target)) queue.push(target);
            }
          }
        }
        return JSON.stringify({ from, reachable: [...visited], count: visited.size });
      }
      case "history": {
        const def = this.parse_machine(params.machine);
        if (!def) return JSON.stringify({ error: "invalid machine JSON" });
        let events: string[];
        try { events = JSON.parse(String(params.events || "[]")); } catch { return JSON.stringify({ error: "invalid events JSON" }); }
        let current = String(params.current || def.initial);
        const history: { state: string; event: string; next: string }[] = [];
        for (const evt of events) {
          const state = def.states.find((s) => s.name === current);
          if (!state) return JSON.stringify({ error: `unknown state: ${current}`, history });
          const next = state.on?.[evt];
          if (!next) return JSON.stringify({ error: `no transition for '${evt}' in '${current}'`, history });
          history.push({ state: current, event: evt, next });
          current = next;
        }
        return JSON.stringify({ final_state: current, steps: history.length, history });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_machine(val: unknown): MachineDefinition | null {
    try {
      const m = JSON.parse(String(val || "{}"));
      if (!m.initial || !Array.isArray(m.states)) return null;
      return m as MachineDefinition;
    } catch { return null; }
  }

  private find_unreachable(def: MachineDefinition): string[] {
    const visited = new Set<string>();
    const queue = [def.initial];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const state = def.states.find((s) => s.name === cur);
      if (state?.on) {
        for (const target of Object.values(state.on)) {
          if (!visited.has(target)) queue.push(target);
        }
      }
    }
    return def.states.filter((s) => !visited.has(s.name)).map((s) => s.name);
  }
}
