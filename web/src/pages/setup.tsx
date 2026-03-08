import { useState, useEffect } from "react";
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
  const [executor, setExecutor] = useState("");
  const [orchestrator, setOrchestrator] = useState("");
  const [alias, setAlias] = useState("assistant");
  const [personaName, setPersonaName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api.get<string[]>("/api/agents/providers/types").then(setProviderTypes).catch(() => toast(t("setup.load_failed"), "err"));
  }, [toast, t]);

  const selected = Object.entries(providers).filter(([, v]) => v.enabled);

  const toggle_provider = (type: string) => {
    setProviders((prev) => {
      const existing = prev[type];
      if (existing) return { ...prev, [type]: { ...existing, enabled: !existing.enabled } };
      return { ...prev, [type]: { type, enabled: true, token: "" } };
    });
  };

  const set_token = (type: string, token: string) => {
    setProviders((prev) => {
      const existing = prev[type] || { type, enabled: true, token: "" };
      return { ...prev, [type]: { ...existing, token } };
    });
  };

  const finish = async () => {
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
        persona_name: personaName || undefined,
      };
      await api.post("/api/bootstrap", payload);
      setStep(3);
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      toast(t("setup.error", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page setup">
      <h2>{t("setup.title")}</h2>
      <div className="setup__steps">
        {[0, 1, 2].map((s) => (
          <div key={s} className={`setup__step-dot${s === step ? " setup__step-dot--active" : ""}${s < step ? " setup__step-dot--done" : ""}`} aria-current={s === step ? "step" : undefined} aria-label={t("setup.step_n", { n: s + 1 })} />
        ))}
      </div>
      <p className="text-muted mb-3">{t("setup.subtitle")}</p>

      {/* Step 0: Provider Selection */}
      {step === 0 && (
        <section>
          <h2>{t("setup.step.providers")}</h2>
          <p className="text-sm text-muted mb-3">
            {t("setup.step.providers.desc")}
          </p>
          <div className="setup__provider-list">
            {providerTypes.map((type) => {
              const entry = providers[type];
              const checked = entry?.enabled ?? false;
              const needs_token = NEEDS_TOKEN.has(type);
              return (
                <div key={type} className="setup__provider-card">
                  <label className="setup__provider-label">
                    <input type="checkbox" checked={checked} onChange={() => toggle_provider(type)} />
                    <strong>{TYPE_LABELS[type] || type}</strong>
                  </label>
                  {checked && needs_token && (
                    <div className="mt-2">
                      <input
                        autoFocus
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
          <div className="setup__nav setup__nav--end">
            <button className="btn btn--primary" disabled={selected.length === 0} onClick={() => {
              const first = selected[0]?.[0] || "";
              if (!executor) setExecutor(first);
              if (!orchestrator) setOrchestrator(first);
              setStep(1);
            }}>
              {t("setup.next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 1: Defaults */}
      {step === 1 && (
        <section>
          <h2>{t("setup.step.defaults")}</h2>
          <p className="text-sm text-muted mb-3">
            {t("setup.step.defaults.desc")}
          </p>
          <div className="setup__field-group">
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
                {selected.map(([type]) => (
                  <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="setup__nav">
            <button className="btn" onClick={() => setStep(0)}>{t("setup.back")}</button>
            <button className="btn btn--primary" onClick={() => setStep(2)}>{t("setup.next")}</button>
          </div>
        </section>
      )}

      {/* Step 2: Identity */}
      {step === 2 && (
        <section>
          <h2>{t("setup.step.identity")}</h2>
          <p className="text-sm text-muted mb-3">
            {t("setup.step.identity.desc")}
          </p>
          <div className="setup__field-group">
            <label>
              <div className="form-label">{t("setup.persona_name")}</div>
              <input
                autoFocus
                type="text"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                placeholder={t("setup.persona_name_placeholder")}
                className="form-input"
              />
              <p className="text-xs text-muted mt-1">{t("setup.persona_name_hint")}</p>
            </label>
            <label>
              <div className="form-label">{t("setup.alias")}</div>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && alias.trim()) void finish(); }}
                className="form-input"
              />
            </label>
          </div>
          <div className="setup__nav">
            <button className="btn" onClick={() => setStep(1)}>{t("setup.back")}</button>
            <button className="btn btn--primary" disabled={submitting || !alias.trim()} onClick={finish}>
              {t("setup.finish")}
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <section className="setup__complete">
          <h2>{t("setup.step.complete")}</h2>
          <p className="text-muted">{t("setup.step.complete.desc")}</p>
        </section>
      )}
    </div>
  );
}
