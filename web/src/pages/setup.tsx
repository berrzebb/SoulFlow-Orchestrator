import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/toast";
import { useT } from "../i18n";

type ProviderEntry = {
  type: string;
  enabled: boolean;
  token: string;
};

const TYPE_LABELS: Record<string, string> = {
  claude_cli: "Claude CLI",
  codex_cli: "Codex CLI",
  claude_sdk: "Claude SDK",
  codex_appserver: "Codex Appserver",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI Compatible",
  gemini_cli: "Gemini CLI",
};

const NEEDS_TOKEN = new Set(["openrouter", "claude_sdk", "openai_compatible"]);

export default function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [providerTypes, setProviderTypes] = useState<string[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({});
  const [executor, setExecutor] = useState("codex_cli");
  const [orchestrator, setOrchestrator] = useState("phi4_local");
  const [alias, setAlias] = useState("assistant");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<string[]>("/api/agent-providers/types").then(setProviderTypes).catch(() => {});
  }, []);

  const selected = Object.entries(providers).filter(([, v]) => v.enabled);

  const toggle_provider = useCallback((type: string) => {
    setProviders((prev) => {
      const existing = prev[type];
      if (existing) return { ...prev, [type]: { ...existing, enabled: !existing.enabled } };
      return { ...prev, [type]: { type, enabled: true, token: "" } };
    });
  }, []);

  const set_token = useCallback((type: string, token: string) => {
    setProviders((prev) => {
      const existing = prev[type] || { type, enabled: true, token: "" };
      return { ...prev, [type]: { ...existing, token } };
    });
  }, []);

  const finish = useCallback(async () => {
    setSubmitting(true);
    try {
      const payload = {
        providers: selected.map(([type, entry], idx) => ({
          instance_id: type,
          provider_type: type,
          label: TYPE_LABELS[type] || type,
          enabled: true,
          priority: (idx + 1) * 10,
          token: entry.token || undefined,
        })),
        executor,
        orchestrator,
        alias,
      };
      await api.post("/api/bootstrap", payload);
      setStep(3);
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      toast(t("setup.error", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSubmitting(false);
    }
  }, [selected, executor, orchestrator, alias, navigate, toast, t]);

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", padding: "0 20px" }}>
      <h1>{t("setup.title")}</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 24 }}>{t("setup.subtitle")}</p>

      {/* Step 0: Provider Selection */}
      {step === 0 && (
        <section>
          <h2>{t("setup.step.providers")}</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
            {t("setup.step.providers.desc")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {providerTypes.map((type) => {
              const entry = providers[type];
              const checked = entry?.enabled ?? false;
              const needs_token = NEEDS_TOKEN.has(type);
              return (
                <div key={type} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle_provider(type)} />
                    <strong>{TYPE_LABELS[type] || type}</strong>
                  </label>
                  {checked && needs_token && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="password"
                        placeholder={t("setup.api_key")}
                        value={entry?.token || ""}
                        onChange={(e) => set_token(type, e.target.value)}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--color-border)" }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn--primary" disabled={selected.length === 0} onClick={() => setStep(1)}>
              {t("setup.next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 1: Defaults */}
      {step === 1 && (
        <section>
          <h2>{t("setup.step.defaults")}</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
            {t("setup.step.defaults.desc")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>{t("setup.executor")}</div>
              <select value={executor} onChange={(e) => setExecutor(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                {selected.map(([type]) => (
                  <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>{t("setup.orchestrator")}</div>
              <select value={orchestrator} onChange={(e) => setOrchestrator(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                <option value="phi4_local">Phi-4 Local</option>
                {selected.map(([type]) => (
                  <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(0)}>{t("setup.back")}</button>
            <button className="btn btn--primary" onClick={() => setStep(2)}>{t("setup.next")}</button>
          </div>
        </section>
      )}

      {/* Step 2: Identity */}
      {step === 2 && (
        <section>
          <h2>{t("setup.step.identity")}</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
            {t("setup.step.identity.desc")}
          </p>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t("setup.alias")}</div>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--color-border)" }}
            />
          </label>
          <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(1)}>{t("setup.back")}</button>
            <button className="btn btn--primary" disabled={submitting || !alias.trim()} onClick={finish}>
              {t("setup.finish")}
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <section style={{ textAlign: "center", padding: "40px 0" }}>
          <h2>{t("setup.step.complete")}</h2>
          <p style={{ color: "var(--color-text-secondary)" }}>{t("setup.step.complete.desc")}</p>
        </section>
      )}
    </div>
  );
}
