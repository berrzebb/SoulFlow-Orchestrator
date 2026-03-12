/**
 * Prompting — Agent 탭.
 * 에이전트 설계(soul·heart·tools) + 테스트 채팅을 한 화면에 통합.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { StudioModelPicker, type StudioModelValue } from "../../components/studio-model-picker";
import { ChatPromptBar } from "../../components/chat-prompt-bar";
import { RunResult, type RunResultValue } from "./run-result";
import type { AgentDefinition } from "../../../../src/agent/agent-definition.types";

type ChatMsg = { role: "user" | "assistant"; content: string };

export function AgentPanel() {
  const t = useT();
  const qc = useQueryClient();
  const chat_end_ref = useRef<HTMLDivElement>(null);

  const { data: definitions = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["agent-definitions"],
    queryFn: () => api.get("/api/agent-definitions"),
    staleTime: 10_000,
  });

  const [selected_id, setSelectedId] = useState<string>("__new__");
  const [model, setModel] = useState<StudioModelValue>({ provider_id: "", model: "" });
  const [soul, setSoul] = useState("");
  const [heart, setHeart] = useState("");
  const [extra, setExtra] = useState("");

  const [ai_prompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [last_result, setLastResult] = useState<RunResultValue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selected_id === "__new__") {
      setModel({ provider_id: "", model: "" }); setSoul(""); setHeart(""); setExtra("");
      return;
    }
    const def = definitions.find((d) => d.id === selected_id);
    if (!def) return;
    const prov = def.preferred_providers[0] ?? "";
    setModel({ provider_id: prov, model: def.model ?? "" });
    setSoul(def.soul); setHeart(def.heart); setExtra(def.extra_instructions);
  }, [selected_id, definitions]);

  useEffect(() => {
    chat_end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, running]);

  const build_system = () => [soul, heart, extra].filter(Boolean).join("\n\n---\n\n");

  const handle_generate = async () => {
    if (!ai_prompt.trim()) return;
    setGenerating(true);
    try {
      const data = await api.post<Partial<AgentDefinition>>("/api/agent-definitions/generate", { prompt: ai_prompt });
      if (data.soul) setSoul(data.soul);
      if (data.heart) setHeart(data.heart);
      if (data.extra_instructions) setExtra(data.extra_instructions);
      if (data.preferred_providers?.[0]) setModel((m) => ({ ...m, provider_id: data.preferred_providers![0]! }));
      if (data.model) setModel((m) => ({ ...m, model: data.model ?? "" }));
    } finally {
      setGenerating(false);
    }
  };

  const handle_send = async () => {
    if (!input.trim() || !model.provider_id) return;
    const user_msg: ChatMsg = { role: "user", content: input.trim() };
    setChat((prev) => [...prev, user_msg]);
    setInput("");
    setRunning(true);
    setLastResult(null);
    try {
      const res = await api.post<RunResultValue>("/api/prompt/run", {
        provider_id: model.provider_id,
        model: model.model || undefined,
        prompt: user_msg.content,
        system: build_system() || undefined,
      });
      setChat((prev) => [...prev, { role: "assistant", content: res.content ?? "(empty)" }]);
      setLastResult(res);
    } catch (err) {
      setChat((prev) => [...prev, { role: "assistant", content: `⚠ ${(err as Error)?.message}` }]);
    } finally {
      setRunning(false);
    }
  };

  const handle_save = async () => {
    if (!soul.trim()) return;
    setSaving(true);
    try {
      const payload = {
        soul, heart, extra_instructions: extra,
        preferred_providers: model.provider_id ? [model.provider_id] : [],
        model: model.model || null,
      };
      if (selected_id === "__new__") {
        await api.post("/api/agent-definitions", { name: soul.slice(0, 40), description: "", icon: "🤖", role_skill: null, tools: [], shared_protocols: [], skills: [], use_when: "", not_use_for: "", is_builtin: false, ...payload });
      } else {
        await api.put(`/api/agent-definitions/${selected_id}`, payload);
      }
      void qc.invalidateQueries({ queryKey: ["agent-definitions"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ps-split">
      {/* ── 왼쪽: 에이전트 설계 ── */}
      <aside className="ps-config">
        {/* 타이틀 */}
        <div className="ps-pane-head">
          <div className="ps-pane-head__icon">🤖</div>
          <span className="ps-pane-head__title">{t("prompting.agent_title")}</span>
        </div>

        {/* 에이전트 선택 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.agent_label")}</span>
          <select
            className="ps-select-sm"
            style={{ height: 32, fontSize: 13 }}
            value={selected_id}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="__new__">{t("prompting.agent_new")}</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>{d.icon} {d.name}{d.is_builtin ? ` ${t("prompting.builtin")}` : ""}</option>
            ))}
          </select>
        </div>

        {/* 모델 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.model")}</span>
          <StudioModelPicker value={model} onChange={setModel} />
        </div>

        {/* AI 자동 생성 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">
            {t("prompting.ai_generate")}
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("prompting.ai_generate_hint")}</span>
          </span>
          <div className="ps-upload-row" style={{ gap: 6 }}>
            <textarea
              className="ps-upload-input"
              style={{ resize: "none", height: 52, lineHeight: 1.4 }}
              value={ai_prompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t("prompting.ai_generate_ph")}
            />
            <button
              className="ps-upload-btn"
              style={{ alignSelf: "stretch", height: "auto" }}
              disabled={generating || !ai_prompt.trim()}
              onClick={() => void handle_generate()}
            >
              {generating ? "…" : t("prompting.generate")}
            </button>
          </div>
        </div>

        {/* Soul */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">
            {t("prompting.soul")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("prompting.soul_hint")}</span>
          </span>
          <textarea
            className="ps-prompt-area"
            style={{ minHeight: 72 }}
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            placeholder={t("prompting.soul_ph")}
          />
        </div>

        {/* Heart */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">
            {t("prompting.heart")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("prompting.heart_hint")}</span>
          </span>
          <textarea
            className="ps-prompt-area"
            style={{ minHeight: 60 }}
            value={heart}
            onChange={(e) => setHeart(e.target.value)}
            placeholder={t("prompting.heart_ph")}
          />
        </div>

        {/* Extra */}
        <div className="ps-pane-sec ps-pane-sec--noborder">
          <span className="ps-pane-sec__label">{t("prompting.extra")}</span>
          <textarea
            className="ps-prompt-area"
            style={{ minHeight: 52 }}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={t("prompting.extra_ph")}
          />
        </div>

        {/* 저장 바 */}
        <div style={{ padding: "10px 16px", display: "flex", gap: 6, borderTop: "1px solid var(--line)" }}>
          <button
            className={`ps-run-btn-main${saving ? " ps-run-btn-main--running" : ""}`}
            style={{ flex: 1, height: 36, borderRadius: 8, fontSize: 13 }}
            disabled={saving || !soul.trim()}
            onClick={() => void handle_save()}
          >
            {saving ? t("prompting.saving") : selected_id === "__new__" ? t("prompting.save") : t("prompting.update")}
          </button>
          {selected_id !== "__new__" && (
            <button className="btn btn--sm" onClick={() => setSelectedId("__new__")}>{t("prompting.new")}</button>
          )}
        </div>
      </aside>

      {/* ── 오른쪽: 채팅 테스트 ── */}
      <main className="ps-preview" style={{ display: "flex", flexDirection: "column" }}>
        {/* 헤더 */}
        <div className="ps-preview-head">
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </span>
            <span className="ps-preview-head__title">{t("prompting.test_chat")}</span>
          </div>
          <div className="ps-preview-head__sub">{t("prompting.test_chat_hint")}</div>
        </div>

        {/* 채팅 메시지 영역 */}
        <div className="ps-output-area" style={{ flex: 1 }}>
          {chat.length === 0 && (
            <div className="ps-preview-empty">
              <div className="ps-preview-empty__icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <span>{t("prompting.test_chat_empty")}</span>
            </div>
          )}
          {chat.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "10px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: msg.role === "user" ? "var(--accent)" : "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
                {msg.role === "user" ? t("prompting.role_user") : t("prompting.role_agent")}
              </span>
              <pre style={{ margin: 0, fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {msg.content}
              </pre>
            </div>
          ))}
          {running && (
            <div style={{ padding: "10px 0", display: "flex", gap: 8, alignItems: "center", color: "var(--muted)", fontSize: 13 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 11-18 0"/><path d="M21 12a9 9 0 00-9-9"/>
              </svg>
              {t("prompting.thinking")}
            </div>
          )}
          {last_result && !running && (
            <div style={{ paddingTop: 6 }}>
              <RunResult value={last_result} />
            </div>
          )}
          <div ref={chat_end_ref} />
        </div>

        {/* 입력 바 */}
        <ChatPromptBar
          input={input}
          setInput={setInput}
          sending={running}
          can_send={!running && input.trim().length > 0 && !!model.provider_id}
          onSend={() => void handle_send()}
          placeholder={t("prompting.chat_placeholder")}
          popupPlacement="up"
        />
      </main>
    </div>
  );
}
