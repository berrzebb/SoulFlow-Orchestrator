import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/toast";
import { useT } from "../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../utils/constants";

type ProviderEntry = {
  type: string;
  enabled: boolean;
  token: string;
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
    <div className="page" style={{ maxWidth: 640, margin: "var(--sp-8) auto" }}>
      <h2>{t("setup.title")}</h2>
      <p className="text-muted" style={{ marginBottom: "var(--sp-4)" }}>{t("setup.subtitle")}</p>

      {/* Step 0: Provider Selection */}
      {step === 0 && (
        <section>
          <h2>{t("setup.step.providers")}</h2>
          <p className="text-sm text-muted" style={{ marginBottom: "var(--sp-3)" }}>
            {t("setup.step.providers.desc")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {providerTypes.map((type) => {
              const entry = providers[type];
              const checked = entry?.enabled ?? false;
              const needs_token = NEEDS_TOKEN.has(type);
              return (
                <div key={type} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "var(--sp-3)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle_provider(type)} />
                    <strong>{TYPE_LABELS[type] || type}</strong>
                  </label>
                  {checked && needs_token && (
                    <div style={{ marginTop: "var(--sp-2)" }}>
                      <input
                        type="password"
                        placeholder={t("setup.api_key")}
                        value={entry?.token || ""}
                        onChange={(e) => set_token(type, e.target.value)}
                        className="form-input"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "var(--sp-4)", display: "flex", justifyContent: "flex-end" }}>
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
          <p className="text-sm text-muted" style={{ marginBottom: "var(--sp-3)" }}>
            {t("setup.step.defaults.desc")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <label>
              <div className="form-label">{t("setup.executor")}</div>
              <select value={executor} onChange={(e) => setExecutor(e.target.value)} className="form-input">
                {selected.map(([type]) => (
                  <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </label>
            <label>
              <div className="form-label">{t("setup.orchestrator")}</div>
              <select value={orchestrator} onChange={(e) => setOrchestrator(e.target.value)} className="form-input">
                <option value="phi4_local">Phi-4 Local</option>
                {selected.map(([type]) => (
                  <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: "var(--sp-4)", display: "flex", justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(0)}>{t("setup.back")}</button>
            <button className="btn btn--primary" onClick={() => setStep(2)}>{t("setup.next")}</button>
          </div>
        </section>
      )}

      {/* Step 2: Identity */}
      {step === 2 && (
        <section>
          <h2>{t("setup.step.identity")}</h2>
          <p className="text-sm text-muted" style={{ marginBottom: "var(--sp-3)" }}>
            {t("setup.step.identity.desc")}
          </p>
          <label>
            <div className="form-label">{t("setup.alias")}</div>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="form-input"
            />
          </label>
          <div style={{ marginTop: "var(--sp-4)", display: "flex", justifyContent: "space-between" }}>
            <button className="btn" onClick={() => setStep(1)}>{t("setup.back")}</button>
            <button className="btn btn--primary" disabled={submitting || !alias.trim()} onClick={finish}>
              {t("setup.finish")}
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <section style={{ textAlign: "center", padding: "var(--sp-8) 0" }}>
          <h2>{t("setup.step.complete")}</h2>
          <p className="text-muted">{t("setup.step.complete.desc")}</p>
        </section>
      )}
    </div>
  );
}
