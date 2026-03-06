import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { Modal, FormModal } from "../components/modal";
import { ToggleSwitch } from "../components/toggle-switch";
import { useToast } from "../components/toast";
import { useTestMutation } from "../hooks/use-test-mutation";
import { useT } from "../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../utils/constants";
import { time_ago } from "../utils/format";

interface ProviderInstance {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  priority: number;
  supported_modes: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

type ModalMode = { kind: "add" } | { kind: "edit"; instance: ProviderInstance };

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderInstance | null>(null);

  const { data: instances, isLoading } = useQuery<ProviderInstance[]>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/agents/providers/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("providers.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["agent-providers"] }); },
    onError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
  });

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("providers.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("providers.add")}
        </button>
      </div>

      {isLoading ? (
        <div className="stat-grid stat-grid--wide">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !instances?.length ? (
        <div className="empty-state">
          <div className="empty-state__icon">🔌</div>
          <div className="empty-state__text">{t("providers.no_instances")}</div>
        </div>
      ) : (
        <div className="stat-grid stat-grid--wide fade-in">
          {instances.map((inst) => (
            <ProviderCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
            />
          ))}
        </div>
      )}

      <CliAuthSection />

      <Modal
        open={!!deleteTarget}
        title={t("providers.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.instance_id);
          setDeleteTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("providers.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        </p>
      </Modal>

      {modal && (
        <ProviderModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["agent-providers"] });
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({ instance, onEdit, onRemove }: {
  instance: ProviderInstance;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const { testing, testResult, test } = useTestMutation({
    url: `/api/agents/providers/${encodeURIComponent(instance.instance_id)}/test`,
    onOk: (r) => `${instance.label}: ${r.detail || t("providers.available")}`,
    onFail: (r) => `${instance.label}: ${r.error || ""}`,
    onError: () => t("providers.test_failed"),
  });

  const status_cls = instance.available ? "ok" : instance.enabled ? "warn" : "off";
  const has_details = instance.supported_modes.length > 0
    || (instance.capabilities && Object.keys(instance.capabilities).length > 0);

  return (
    <div className={`stat-card desk--${status_cls}`}>
      <div className="stat-card__header stat-card__header--wrap">
        <Badge status={TYPE_LABELS[instance.provider_type] || instance.provider_type} variant="info" />
        <span className="stat-card__tags mt-0 mb-0">
          <Badge status={instance.enabled ? t("providers.on") : t("providers.off")} variant={instance.enabled ? "ok" : "off"} />
          {instance.available && <Badge status={t("providers.available")} variant="ok" />}
          {instance.circuit_state !== "closed" && (
            <Badge status={instance.circuit_state} variant={instance.circuit_state === "open" ? "err" : "warn"} />
          )}
        </span>
      </div>
      <div className="stat-card__value stat-card__value--md">
        {instance.label || instance.instance_id}
      </div>
      <div className="stat-card__label">{instance.instance_id}</div>
      <div className="stat-card__extra">
        {instance.token_configured
          ? <span className="text-ok">{t("providers.token_configured")}</span>
          : <span className="text-err">{t("providers.no_token")}</span>
        }
        {" · "}
        <span className="text-muted">{t("providers.priority")}: {instance.priority}</span>
        {has_details && (
          <button
            className="provider-card__expand"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t("common.collapse") : t("common.expand")}
          >
            {expanded ? "▾" : "▸"} {t("providers.details")}
          </button>
        )}
      </div>
      {expanded && (
        <>
          {instance.supported_modes.length > 0 && (
            <div className="stat-card__tags">
              {instance.supported_modes.map((m) => <Badge key={m} status={m} variant="info" />)}
            </div>
          )}
          {instance.capabilities && Object.keys(instance.capabilities).length > 0 && (
            <div className="stat-card__tags">
              {Object.entries(instance.capabilities).map(([cap, ok]) => (
                <Badge key={cap} status={cap} variant={ok ? "ok" : "off"} />
              ))}
            </div>
          )}
        </>
      )}
      {instance.updated_at && (
        <div className="text-xs text-muted" title={instance.updated_at}>{time_ago(instance.updated_at)}</div>
      )}
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? t("providers.pass") : t("providers.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--ok" onClick={() => test()} disabled={testing || !instance.token_configured}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}

// ── CLI Auth Section ─────────────────────────────────────────────────────────

interface CliAuthStatus {
  cli: string;
  authenticated: boolean;
  account?: string;
  error?: string;
}

interface LoginResult {
  cli: string;
  state: string;
  login_url?: string;
  error?: string;
}

function CliAuthSection() {
  const t = useT();
  const { toast } = useToast();

  const { data: statuses, refetch } = useQuery<CliAuthStatus[]>({
    queryKey: ["cli-auth-status"],
    queryFn: () => api.get("/api/auth/cli/status"),
    refetchInterval: 30_000,
  });

  const checkAll = useMutation({
    mutationFn: () => api.post<CliAuthStatus[]>("/api/auth/cli/check"),
    onSuccess: (data) => {
      void refetch();
      for (const s of data) {
        toast(`${s.cli}: ${s.authenticated ? t("cli_auth.authenticated") : t("cli_auth.not_authenticated")}`, s.authenticated ? "ok" : "err");
      }
    },
    onError: () => toast(t("providers.check_failed"), "err"),
  });

  const login = useMutation({
    mutationFn: (cli: string) => api.post<LoginResult>("/api/auth/cli/sessions", { cli }),
  });

  const cancel = useMutation({
    mutationFn: (cli: string) => api.del(`/api/auth/cli/sessions/${encodeURIComponent(cli)}`),
    onSuccess: () => { login.reset(); void refetch(); },
  });

  const loginResult = login.data;

  return (
    <div className="cli-auth-section">
      <div className="section-header">
        <h3>{t("cli_auth.title")}</h3>
        <button
          className="btn btn--sm"
          onClick={() => checkAll.mutate()}
          disabled={checkAll.isPending}
        >
          {checkAll.isPending ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      {!statuses?.length ? (
        <div className="empty-state"><div className="empty-state__icon">🤖</div><div className="empty-state__text">{t("cli_auth.no_agents")}</div></div>
      ) : (
        <div className="stat-grid stat-grid--wide">
          {statuses.map((s) => (
            <div key={s.cli} className={`stat-card desk--${s.authenticated ? "ok" : "warn"}`}>
              <div className="stat-card__header">
                <Badge status={s.cli === "claude" ? "Claude Code" : s.cli === "codex" ? "Codex CLI" : "Gemini CLI"} variant="info" />
                <Badge
                  status={s.authenticated ? t("cli_auth.authenticated") : t("cli_auth.not_authenticated")}
                  variant={s.authenticated ? "ok" : "warn"}
                />
              </div>
              <div className="stat-card__value stat-card__value--md">
                {s.account || s.cli}
              </div>
              {s.error && (
                <div className="stat-card__label text-warn">
                  {s.error}
                </div>
              )}
              {!s.authenticated && (
                <div className="mt-2">
                  <button
                    className="btn btn--sm btn--accent"
                    onClick={() => login.mutate(s.cli)}
                    disabled={login.isPending}
                  >
                    {t("cli_auth.login")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loginResult?.login_url && (
        <div className="stat-card cli-auth-section__result">
          <p className="mb-2">
            <strong>{loginResult.cli}</strong> — {t("cli_auth.open_url")}
          </p>
          <a
            className="cli-auth-section__url"
            href={loginResult.login_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {loginResult.login_url}
          </a>
          <div className="cli-auth-section__actions">
            <button className="btn btn--sm" onClick={() => cancel.mutate(loginResult.cli)}>
              {t("cli_auth.cancel_login")}
            </button>
            <button className="btn btn--sm" onClick={() => { login.reset(); void refetch(); }}>
              {t("cli_auth.done")}
            </button>
          </div>
        </div>
      )}

      {loginResult?.state === "failed" && loginResult.error && (
        <div className="stat-card desk--err cli-auth-section__result">
          <p>{t("cli_auth.login_failed", { error: loginResult.error })}</p>
        </div>
      )}
    </div>
  );
}

const MODE_OPTIONS = ["once", "agent", "task"] as const;

/** openai_compatible / openrouter 처럼 타입별 추가 설정이 필요한 프로바이더 */
const TYPES_WITH_SETTINGS = new Set(["openai_compatible", "openrouter"]);

function ProviderModal({ mode, onClose, onSaved }: {
  mode: ModalMode;
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const [token, setToken] = useState("");
  const [selectedModes, setSelectedModes] = useState<Set<string>>(
    new Set(initial?.supported_modes ?? ["once", "agent", "task"]),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // ── 타입별 설정 ──
  const s = initial?.settings ?? {};
  const [apiBase, setApiBase] = useState(typeof s.api_base === "string" ? s.api_base : "");
  const [model, setModel] = useState(typeof s.model === "string" ? s.model : "");
  const [maxTokens, setMaxTokens] = useState(typeof s.max_tokens === "number" ? String(s.max_tokens) : "");
  const [temperature, setTemperature] = useState(typeof s.temperature === "number" ? String(s.temperature) : "");
  const [siteUrl, setSiteUrl] = useState(typeof s.site_url === "string" ? s.site_url : "");
  const [appName, setAppName] = useState(typeof s.app_name === "string" ? s.app_name : "");

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
            <input className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={providerType === "openrouter" ? "anthropic/claude-sonnet-4" : "gpt-4o"} />
            <span className="form-hint">{t(providerType === "openrouter" ? "providers.model_hint_openrouter" : "providers.model_hint_openai")}</span>
          </div>

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
