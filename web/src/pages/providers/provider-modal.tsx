import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { FormModal } from "../../components/modal";
import { Combobox, type ComboboxOption } from "../../components/combobox";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import { MODE_OPTIONS, PURPOSE_OPTIONS, TYPES_WITH_SETTINGS, TYPES_WITH_MODELS } from "./types";
import type { ModalMode, ModelInfo, ProviderConnection, CliAuthStatus } from "./types";

interface ProviderModalProps {
  mode: ModalMode;
  connections: ProviderConnection[];
  onClose: () => void;
  onSaved: () => void;
}

function format_price(price?: number): string {
  if (price == null) return "—";
  if (price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

export function ProviderModal({ mode, connections, onClose, onSaved }: ProviderModalProps) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.instance : null;
  const defaultPurpose = mode.kind === "add" ? mode.defaultPurpose : undefined;
  const t = useT();

  const { data: types = [] } = useQuery<string[]>({
    queryKey: ["agent-provider-types"],
    queryFn: () => api.get("/api/agents/providers/types"),
  });

  const { data: cliStatuses = [] } = useQuery<CliAuthStatus[]>({
    queryKey: ["cli-auth-status"],
    queryFn: () => api.get("/api/auth/cli/status"),
    staleTime: 30_000,
  });

  const [connectionId, setConnectionId] = useState(initial?.connection_id || "");
  const selectedConnection = connections.find((c) => c.connection_id === connectionId);
  const effectiveProviderType = selectedConnection?.provider_type;

  const [providerType, setProviderType] = useState(initial?.provider_type || "claude_sdk");
  const [instanceId, setInstanceId] = useState(initial?.instance_id || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 10);
  const [modelPurpose, setModelPurpose] = useState<"chat" | "embedding">(initial?.model_purpose || defaultPurpose || "chat");
  const [token, setToken] = useState("");
  const [selectedModes, setSelectedModes] = useState<Set<string>>(
    new Set(initial?.supported_modes ?? ["once", "agent", "task"]),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const resolvedType = effectiveProviderType || providerType;

  const s = initial?.settings ?? {};
  const [apiBase, setApiBase] = useState(typeof s.api_base === "string" ? s.api_base : "");
  const [model, setModel] = useState(typeof s.model === "string" ? s.model : "");
  const [maxTokens, setMaxTokens] = useState(typeof s.max_tokens === "number" ? String(s.max_tokens) : "");
  const [temperature, setTemperature] = useState(typeof s.temperature === "number" ? String(s.temperature) : "");
  const [siteUrl, setSiteUrl] = useState(typeof s.site_url === "string" ? s.site_url : "");
  const [appName, setAppName] = useState(typeof s.app_name === "string" ? s.app_name : "");

  const canFetchModels = TYPES_WITH_MODELS.has(resolvedType);
  const { data: modelList, isLoading: modelsLoading } = useQuery<ModelInfo[]>({
    queryKey: ["provider-models", connectionId || resolvedType, apiBase],
    queryFn: () => {
      // connection이 있으면 connection별 모델 API 사용
      if (connectionId) {
        return api.get(`/api/agents/connections/${encodeURIComponent(connectionId)}/models`);
      }
      const params = new URLSearchParams();
      if (apiBase) params.set("api_base", apiBase);
      const qs = params.toString();
      return api.get(`/api/agents/providers/models/${encodeURIComponent(resolvedType)}${qs ? `?${qs}` : ""}`);
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

  const modelOptions = useMemo<ComboboxOption[]>(() =>
    filteredModels.map((m) => {
      const parts: string[] = [];
      if (m.pricing_input != null) parts.push(`${format_price(m.pricing_input)}/M`);
      if (m.context_length) parts.push(`${Math.round(m.context_length / 1000)}K`);
      return { value: m.id, label: m.name, detail: parts.join(" · ") || undefined };
    }),
  [filteredModels]);

  const toggle_mode = (m: string) => {
    const next = new Set(selectedModes);
    if (next.has(m)) next.delete(m); else next.add(m);
    setSelectedModes(next);
  };

  function build_settings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (resolvedType === "openai_compatible" && apiBase && !connectionId) out.api_base = apiBase;
    if (model) out.model = model;
    if (maxTokens) out.max_tokens = Number(maxTokens);
    if (temperature) out.temperature = Number(temperature);
    if (resolvedType === "openrouter") {
      if (siteUrl) out.site_url = siteUrl;
      if (appName) out.app_name = appName;
    }
    return out;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = isEdit ? initial!.instance_id : (instanceId || resolvedType);
      const body = {
        provider_type: resolvedType,
        label: label || id,
        enabled,
        priority,
        model_purpose: modelPurpose,
        supported_modes: [...selectedModes],
        settings: build_settings(),
        ...(connectionId ? { connection_id: connectionId } : {}),
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

  // 등록된 프로바이더만 표시: connection에 존재하거나 CLI 인증된 타입
  const registeredTypes = useMemo(() => {
    const connTypes = new Set(connections.filter((c) => c.enabled).map((c) => c.provider_type));
    const CLI_TYPE_MAP: Record<string, string> = { claude: "claude_cli", codex: "codex_cli", gemini: "gemini_cli" };
    for (const s of cliStatuses) {
      if (s.authenticated && CLI_TYPE_MAP[s.cli]) connTypes.add(CLI_TYPE_MAP[s.cli]);
    }
    // claude_cli가 있으면 claude_sdk도 사용 가능
    if (connTypes.has("claude_cli")) connTypes.add("claude_sdk");
    if (connTypes.has("codex_cli")) connTypes.add("codex_appserver");
    return connTypes;
  }, [connections, cliStatuses]);

  const allTypes = types.length > 0 ? types : Object.keys(TYPE_LABELS);
  const typeOptions = isEdit ? allTypes : allTypes.filter((tp) => registeredTypes.has(tp));
  const showExtendedSettings = TYPES_WITH_SETTINGS.has(resolvedType);

  return (
    <FormModal
      open
      title={isEdit ? t("providers.edit_title") : t("providers.add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
    >
      {/* Connection 선택 (선택사항) */}
      {connections.length > 0 && (
        <div className="form-group">
          <label className="form-label">{t("connections.select")}</label>
          <select
            className="form-input"
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
              const conn = connections.find((c) => c.connection_id === e.target.value);
              if (conn) setProviderType(conn.provider_type);
            }}
          >
            <option value="">{t("connections.none")}</option>
            {connections.filter((c) => c.enabled).map((c) => (
              <option key={c.connection_id} value={c.connection_id}>
                {c.label} ({TYPE_LABELS[c.provider_type] || c.provider_type})
              </option>
            ))}
          </select>
          <span className="form-hint">{t("connections.select_hint")}</span>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">{t("providers.provider_type")}</label>
        {isEdit || connectionId ? (
          <input className="form-input" value={TYPE_LABELS[resolvedType] || resolvedType} disabled />
        ) : typeOptions.length === 0 ? (
          <div className="text-sm text-warn">{t("providers.no_registered_providers")}</div>
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
          placeholder={resolvedType}
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

      {!connectionId && (
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
          <span className="form-hint">{t("connections.token_from_connection_hint")}</span>
        </div>
      )}

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

      {/* Model — 모든 프로바이더 타입에서 표시 */}
      <fieldset className="form-fieldset">
        <legend className="form-fieldset__legend">{t("providers.model_settings")}</legend>

        {showExtendedSettings && resolvedType === "openai_compatible" && !connectionId && (
          <div className="form-group">
            <label className="form-label">{t("providers.api_base")}</label>
            <input className="form-input" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.openai.com/v1" />
            <span className="form-hint">{t("providers.api_base_hint")}</span>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{t("providers.model")}</label>
          {canFetchModels && modelOptions.length > 0 ? (
            <Combobox
              options={modelOptions}
              value={model}
              onChange={setModel}
              placeholder={t("providers.model_select_placeholder")}
              loading={modelsLoading}
              loadingText={t("providers.models_loading")}
            />
          ) : (
            <input className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={resolvedType === "openrouter" ? "anthropic/claude-sonnet-4" : "gpt-4o"} />
          )}
          {canFetchModels && !modelsLoading && modelList && modelList.length > 0 && modelOptions.length === 0 && (
            <span className="form-hint text-warn">{t("providers.no_models_for_purpose")}</span>
          )}
          <span className="form-hint">{t("providers.model_hint")}</span>
        </div>

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
            <input className="form-input" type="number" min={1} value={maxTokens || ""} onChange={(e) => setMaxTokens(e.target.value === "" ? "" : Number(e.target.value))} placeholder="—" />
          </div>
          <div className="form-group">
            <label className="form-label">{t("providers.temperature")}</label>
            <input className="form-input" type="number" min={0} max={2} step={0.1} value={temperature || ""} onChange={(e) => setTemperature(e.target.value === "" ? "" : Number(e.target.value))} placeholder="—" />
          </div>
        </div>

        {showExtendedSettings && resolvedType === "openrouter" && (
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
    </FormModal>
  );
}
