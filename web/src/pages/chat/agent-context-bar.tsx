import { useState } from "react";
import { useT } from "../../i18n";
import type { AgentDefinition } from "../../../../src/agent/agent-definition.types";

interface AgentContextBarProps {
  definitions: AgentDefinition[];
  activeDefinition: AgentDefinition | null;
  systemPrompt: string;
  onDefinitionChange: (def: AgentDefinition | null) => void;
  onSystemPromptChange: (v: string) => void;
}

/** soul + heart 필드를 결합해 기본 시스템 프롬프트 생성 */
export function compose_agent_prompt(def: AgentDefinition): string {
  return [def.soul, def.heart].filter(Boolean).join("\n\n");
}

export function AgentContextBar({
  definitions,
  activeDefinition,
  systemPrompt,
  onDefinitionChange,
  onSystemPromptChange,
}: AgentContextBarProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  function handle_select(id: string) {
    if (!id) {
      onDefinitionChange(null);
      onSystemPromptChange("");
      setExpanded(false);
      return;
    }
    const def = definitions.find((d) => d.id === id) ?? null;
    onDefinitionChange(def);
    if (def) onSystemPromptChange(compose_agent_prompt(def));
  }

  return (
    <div className={`agent-context-bar${expanded ? " agent-context-bar--expanded" : ""}`}>
      <div className="agent-context-bar__row">
        <span className="agent-context-bar__icon">🧠</span>
        <select
          className="input input--xs agent-context-bar__select"
          value={activeDefinition?.id ?? ""}
          onChange={(e) => handle_select(e.target.value)}
          aria-label={t("chat.agent_select_placeholder")}
        >
          <option value="">— {t("chat.agent_select_placeholder")} —</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon} {d.name}{d.role_skill ? ` (${d.role_skill.replace("role:", "")})` : ""}
            </option>
          ))}
        </select>

        {activeDefinition && (
          <>
            <button
              className={`btn btn--xs agent-context-bar__prompt-toggle${expanded ? " btn--accent" : ""}`}
              onClick={() => setExpanded((v) => !v)}
              title={t("chat.system_prompt_label")}
            >
              {t("chat.system_prompt_label")}
            </button>
            <button
              className="btn btn--xs btn--ghost agent-context-bar__clear"
              onClick={() => handle_select("")}
              title={t("chat.agent_clear")}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {expanded && activeDefinition && (
        <textarea
          className="input code-textarea agent-context-bar__prompt"
          rows={4}
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          placeholder={t("chat.system_prompt_placeholder")}
          spellCheck={false}
        />
      )}
    </div>
  );
}
