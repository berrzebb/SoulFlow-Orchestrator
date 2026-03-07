import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { FormModal } from "../../components/modal";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import { MODE_OPTIONS, PURPOSE_OPTIONS, TYPES_WITH_SETTINGS, TYPES_WITH_MODELS } from "./types";
import type { ModalMode, ModelInfo } from "./types";

interface ProviderModalProps {
  mode: ModalMode;
  onClose: () => void;
  onSaved: () => void;
}

function format_price(price?: number): string {
  if (price == null) return "—";
  if (price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

export function ProviderModal({ mode, onClose, onSaved }: ProviderModalProps) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.instance : null;
  const t = useT();

  const { data: types = [] } = useQuery<string[]>({
    queryKey: ["agent-provider-types"],
    queryFn: () => api.get("/api/agents/providers/types"),
  });

  const [providerType, setProviderType] = useState(initial?.provider_type || "claude_sdk");
  const [instanceId, setInstanceId] = useState(initial?.instance_id || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 10);
  const [modelPurpose, setModelPurpose] = useState<"chat" | "embedding">(initial?.model_purpose || "chat");
  const [token, setToken] = useState("");
  const [selectedModes, setSelectedModes] = useState<Set<string>>(
    new Set(initial?.supported_modes ?? ["once", "agent", "task"]),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const s = initial?.settings ?? {};
  const [apiBase, setApiBase] = useState(typeof s.api_base === "string" ? s.api_base : "");
  const [model, setModel] = useState(typeof s.model === "string" ? s.model : "");
  const [maxTokens, setMaxTokens] = useState(typeof s.max_tokens === "number" ? String(s.max_tokens) : "");
  const [temperature, setTemperature] = useState(typeof s.temperature === "number" ? String(s.temperature) : "");
  const [siteUrl, setSiteUrl] = useState(typeof s.site_url === "string" ? s.site_url : "");
  const [appName, setAppName] = useState(typeof s.app_name === "string" ? s.app_name : "");

  const canFetchModels = TYPES_WITH_MODELS.has(providerType);
  const { data: modelList, isLoading: modelsLoading } = useQuery<ModelInfo[]>({
    queryKey: ["provider-models", providerType, apiBase],
    queryFn: () => {
      const params = new URLSearchParams();
      if (apiBase) params.set("api_base", apiBase);
      const qs = params.toString();
      return api.get(`/api/agents/providers/models/${encodeURIComponent(providerType)}${qs ? `?${qs}` : ""}`);
    },
    enabled: canFetchModels,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const filteredModels = useMemo(() => {
    if (!modelList) return [];
    return modelList.filter((m) =>
      modelPurpose === "embedding"
        ? m.purpose === "embedding" || m.purpose === "both"
        : m.purpose === "chat" || m.purpose === "both",
    );
  }, [modelList, modelPurpose]);

  const toggle_mode = (m: string) => {
    const next = new Set(selectedModes);
    if (next.has(m)) next.delete(m); else next.add(m);
    setSelectedModes(next);
  };

  function build_settings(): Record<string, unknown> {
    if (!TYPES_WITH_SETTINGS.has(providerType)) return {};
    const out: Record<string, unknown> = {};
    if (providerType === "openai_compatible" && apiBase) out.api_base = apiBase;
    if (model) out.model = model;
    if (maxTokens) out.max_tokens = Number(maxTokens);
    if (temperature) out.temperature = Number(temperature);
    if (providerType === "openrouter") {
      if (siteUrl) out.site_url = siteUrl;
      if (appName) out.app_name = appName;
    }
    return out;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = isEdit ? initial!.instance_id : (instanceId || providerType);
      const body = {
        provider_type: providerType,
        label: label || id,
        enabled,
        priority,
        model_purpose: modelPurpose,
        supported_modes: [...selectedModes],
        settings: build_settings(),
        ...(token ? { token } : {}),
      };
      if (isEdit) {
        await api.put(`/api/agents/providers/${encodeURIComponent(id)}`, body);
      } else {
        await api.post("/api/agents/providers", { instance_id: id, ...body });
      }
      toast(isEdit ? t("providers.updated") : t("providers.added"), "ok");
      onSaved();
    } catch (err) {
      toast(t("providers.save_failed", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSaving(false);
    }
  }

  const typeOptions = types.length > 0 ? types : Object.keys(TYPE_LABELS);
  const showSettings = TYPES_WITH_SETTINGS.has(providerType);

  return (
    <FormModal
      open
      title={isEdit ? t("providers.edit_title") : t("providers.add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
    >
      <div className="form-group">
        <label className="form-label">{t("providers.provider_type")}</label>
        {isEdit ? (
          <input className="form-input" value={TYPE_LABELS[providerType] || providerType} disabled />
        ) : (
          <select className="form-input" value={providerType} onChange={(e) => setProviderType(e.target.value)}>
            {typeOptions.map((tp) => <option key={tp} value={tp}>{TYPE_LABELS[tp] || tp}</option>)}
          </select>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.instance_id")}</label>
        <input
          className="form-input"
          value={instanceId || (isEdit ? initial!.instance_id : "")}
          onChange={(e) => setInstanceId(e.target.value)}
          disabled={isEdit}
          placeholder={providerType}
        />
        {!isEdit && <span className="form-hint">{t("providers.instance_id_hint")}</span>}
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.label")}</label>
        <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("providers.label_placeholder")} />
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.model_purpose")}</label>
        <div className="checkbox-group">
          {PURPOSE_OPTIONS.map((p) => (
            <label key={p} className={`chip-label${modelPurpose === p ? " chip-label--active" : ""}`}>
              <input type="radio" name="model_purpose" value={p} checked={modelPurpose === p} onChange={() => setModelPurpose(p)} className="sr-only" />
              {p === "chat" ? t("providers.purpose_chat") : t("providers.purpose_embedding")}
            </label>
          ))}
        </div>
      </div>

      <div className="form-group form-group--row">
        <label className="form-label">{t("common.enabled")}</label>
        <ToggleSwitch checked={enabled} onChange={setEnabled} aria-label={t("common.enabled")} />
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.priority")}</label>
        <input
          className="form-input"
          type="number"
          min={0}
          max={100}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        />
        <span className="form-hint">{t("providers.priority_hint")}</span>
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.api_token")}</label>
        <input
          className="form-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={isEdit ? t("providers.token_placeholder_edit") : t("providers.token_placeholder_new")}
          autoComplete="off"
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t("providers.modes")}</label>
        <div className="checkbox-group">
          {MODE_OPTIONS.map((m) => (
            <label key={m} className="checkbox-label">
              <input type="checkbox" checked={selectedModes.has(m)} onChange={() => toggle_mode(m)} />
              {m}
            </label>
          ))}
        </div>
      </div>

      {showSettings && (
        <fieldset className="form-fieldset">
          <legend className="form-fieldset__legend">{t("providers.settings")}</legend>

          {providerType === "openai_compatible" && (
            <div className="form-group">
              <label className="form-label">{t("providers.api_base")}</label>
              <input className="form-input" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.openai.com/v1" />
              <span className="form-hint">{t("providers.api_base_hint")}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t("providers.model")}</label>
            {canFetchModels && filteredModels.length > 0 ? (
              <>
                <select
                  className="form-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">{t("providers.model_select_placeholder")}</option>
                  {filteredModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.pricing_input != null ? ` — ${format_price(m.pricing_input)}/M in` : ""}
                      {m.context_length ? ` · ${Math.round(m.context_length / 1000)}K ctx` : ""}
                    </option>
                  ))}
                </select>
                {modelsLoading && <span className="form-hint">{t("providers.models_loading")}</span>}
              </>
            ) : (
              <input className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={providerType === "openrouter" ? "anthropic/claude-sonnet-4" : "gpt-4o"} />
            )}
            <span className="form-hint">{t(providerType === "openrouter" ? "providers.model_hint_openrouter" : "providers.model_hint_openai")}</span>
          </div>

          {/* 선택된 모델의 비용 정보 */}
          {model && filteredModels.length > 0 && (() => {
            const selected = filteredModels.find((m) => m.id === model);
            if (!selected || (selected.pricing_input == null && !selected.context_length)) return null;
            return (
              <div className="model-cost-info">
                {selected.pricing_input != null && (
                  <span className="model-cost-info__item">
                    <span className="text-muted">{t("providers.cost_input")}:</span> {format_price(selected.pricing_input)}/M
                  </span>
                )}
                {selected.pricing_output != null && (
                  <span className="model-cost-info__item">
                    <span className="text-muted">{t("providers.cost_output")}:</span> {format_price(selected.pricing_output)}/M
                  </span>
                )}
                {selected.context_length != null && (
                  <span className="model-cost-info__item">
                    <span className="text-muted">{t("providers.context_length")}:</span> {selected.context_length.toLocaleString()}
                  </span>
                )}
                {selected.cost_score != null && (
                  <span className="model-cost-info__item">
                    <span className="text-muted">{t("providers.cost_score")}:</span> {selected.cost_score}
                  </span>
                )}
              </div>
            );
          })()}

          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">{t("providers.max_tokens")}</label>
              <input className="form-input" type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="—" />
            </div>
            <div className="form-group">
              <label className="form-label">{t("providers.temperature")}</label>
              <input className="form-input" type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="—" />
            </div>
          </div>

          {providerType === "openrouter" && (
            <>
              <div className="form-group">
                <label className="form-label">{t("providers.site_url")}</label>
                <input className="form-input" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" />
                <span className="form-hint">{t("providers.site_url_hint")}</span>
              </div>
              <div className="form-group">
                <label className="form-label">{t("providers.app_name")}</label>
                <input className="form-input" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="My App" />
                <span className="form-hint">{t("providers.app_name_hint")}</span>
              </div>
            </>
          )}
        </fieldset>
      )}
    </FormModal>
  );
}
