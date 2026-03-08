import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { ToggleSwitch } from "../components/toggle-switch";
import { useToast } from "../components/toast";
import { useT } from "../i18n";

interface FieldInfo {
  path: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  value: unknown;
  default_value: unknown;
  overridden: boolean;
  sensitive: boolean;
  sensitive_set: boolean;
  restart_required: boolean;
  options?: string[];
  description?: string;
}

interface SectionInfo {
  id: string;
  label: string;
  fields: FieldInfo[];
}

interface ConfigResponse {
  raw: Record<string, unknown>;
  sections: SectionInfo[];
}

const CHANNEL_SECTIONS = new Set(["slack", "discord", "telegram", "channel", "channel.streaming", "channel.dispatch", "channel.dedupe"]);

export default function SettingsPage() {
  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
    staleTime: 30_000,
  });
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const t = useT();

  if (isLoading || !data) return (
    <div className="page">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton skeleton--row" style={{ marginBottom: "12px" }} />
      ))}
    </div>
  );

  const sections = (data.sections ?? []).filter((s) => !CHANNEL_SECTIONS.has(s.id));
  const q = search.toLowerCase();
  const filtered_sections = sections
    .filter((s) => !active || s.id === active)
    .map((s) => ({
      ...s,
      fields: q ? s.fields.filter((f) => f.path.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) : s.fields,
    }))
    .filter((s) => s.fields.length > 0);

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("settings.title")}</h2>
        <input
          autoFocus
          className="input input--sm section-header__search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.search")}
        />
      </div>
      <p className="text-xs text-muted mb-3">
        {t("settings.description")}
      </p>

      <div className="settings__filters" role="tablist">
        <button
          role="tab"
          aria-selected={!active}
          className={`btn btn--sm ${!active ? "btn--primary" : ""}`}
          onClick={() => setActive(null)}
        >
          {t("settings.all")}
        </button>
        {sections.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={active === s.id}
            className={`btn btn--sm ${active === s.id ? "btn--primary" : ""}`}
            onClick={() => setActive(s.id)}
          >
            {t(`cfg.section.${s.id}`)}
            <span className="settings__filter-count">{s.fields.length}</span>
          </button>
        ))}
      </div>

      {filtered_sections.map((s) => (
        <SectionPanel key={s.id} section={s} />
      ))}
      {search && filtered_sections.length === 0 && (
        <div className="empty-state"><div className="empty-state__icon">🔍</div><div className="empty-state__text">{t("settings.no_match")}</div></div>
      )}
    </div>
  );
}

function SectionPanel({ section }: { section: SectionInfo }) {
  const t = useT();
  return (
    <section className="panel mb-3">
      <h2>{t(`cfg.section.${section.id}`)}</h2>
      <div className="settings__field-list">
        {section.fields.map((f) => (
          <FieldCard key={f.path} field={f} sectionFields={section.fields} />
        ))}
      </div>
    </section>
  );
}

function FieldCard({ field, sectionFields }: { field: FieldInfo; sectionFields?: FieldInfo[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const t = useT();

  const save = useMutation({
    mutationFn: (value: unknown) => api.put("/api/config/values", { path: field.path, value }),
    onSuccess: () => {
      toast(t("settings.saved_fmt", { path: field.path }), "ok");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["config"] });
    },
    onError: () => toast(t("settings.save_failed_fmt", { path: field.path }), "err"),
  });

  const reset = useMutation({
    mutationFn: () => api.del("/api/config/values", { path: field.path }),
    onSuccess: () => {
      toast(t("settings.reset_fmt", { path: field.path }), "ok");
      void qc.invalidateQueries({ queryKey: ["config"] });
    },
    onError: () => toast(t("settings.reset_failed_fmt", { path: field.path }), "err"),
  });

  const start_edit = () => {
    if (field.type === "boolean") {
      save.mutate(!(field.value as boolean));
      return;
    }
    setDraft(field.sensitive ? "" : String(field.value ?? ""));
    setEditing(true);
  };

  const commit = () => {
    let parsed: unknown = draft;
    if (field.type === "number") {
      const n = Number(draft);
      if (!Number.isFinite(n)) { toast(t("settings.invalid_number"), "err"); return; }
      parsed = n;
    }
    save.mutate(parsed);
  };

  return (
    <div className={`cfg-field${editing ? " cfg-field--editing" : ""}`}>
      <div className="cfg-field__label">
        <div className="cfg-field__name">
          <span>{t(`cfg.${field.path}`)}</span>
          {field.restart_required && <Badge status={t("settings.restart")} variant="warn" />}
          {field.overridden && <Badge status={t("settings.override")} variant="info" />}
        </div>
        <div className="cfg-field__path">{field.path}</div>
        {field.description && (
          <div className="cfg-field__desc">{t(`cfg.${field.path}.desc`)}</div>
        )}
        {field.default_value !== undefined && field.default_value !== null && field.default_value !== "" && !field.sensitive && (
          <div className="cfg-field__default">{t("settings.default")}: {String(field.default_value)}</div>
        )}
      </div>

      <div className="cfg-field__value">
        {editing ? (
          <EditInline field={field} draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => setEditing(false)} isPending={save.isPending} sectionFields={sectionFields} />
        ) : (
          <div className="cfg-field__value-row">
            <ValueDisplay field={field} onClick={start_edit} />
            {field.overridden && field.type !== "boolean" && (
              <button
                className="cfg-field__reset"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                title={t("common.reset")}
                aria-label={t("common.reset")}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ValueDisplay({ field, onClick }: { field: FieldInfo; onClick: () => void }) {
  const t = useT();
  if (field.type === "boolean") {
    return (
      <ToggleSwitch
        checked={field.value as boolean}
        onChange={() => onClick()}
        aria-label={t("settings.toggle_field", { label: field.label })}
      />
    );
  }

  const kb = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } };

  if (field.sensitive) {
    return (
      <span
        className={`cfg-value cfg-value--clickable ${field.sensitive_set ? "" : "cfg-value--empty"}`}
        role="button" tabIndex={0} onClick={onClick} onKeyDown={kb}
        title={t("settings.click_to_edit")}
      >
        {field.sensitive_set ? "••••••••" : t("settings.not_set")}
      </span>
    );
  }

  if (field.type === "select") {
    const has_value = field.value !== undefined && field.value !== null && field.value !== "";
    return (
      <span className="cfg-value cfg-value--clickable li-flex" role="button" tabIndex={0} onClick={onClick} onKeyDown={kb} title={t("settings.click_to_edit")}>
        <span className="cfg-value__chip">
          {has_value ? String(field.value) : <span className="cfg-value--empty-italic">{t("settings.empty_value")}</span>}
        </span>
        <span className="text-xs text-muted">▾</span>
      </span>
    );
  }

  return (
    <span
      className={`cfg-value cfg-value--clickable cfg-value--mono ${field.value ? "" : "cfg-value--empty"}`}
      role="button" tabIndex={0} onClick={onClick} onKeyDown={kb}
      title={t("settings.click_to_edit")}
    >
      {String(field.value ?? "") || <span className="cfg-value--empty-italic">{t("settings.empty_value")}</span>}
    </span>
  );
}

function EditInline({
  field, draft, setDraft, onCommit, onCancel, isPending, sectionFields,
}: {
  field: FieldInfo;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  isPending: boolean;
  sectionFields?: FieldInfo[];
}) {
  const t = useT();
  const on_key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) onCommit();
    if (e.key === "Escape") onCancel();
  };

  if (field.type === "select" && field.options) {
    return (
      <div className="cfg-edit-row">
        <select className="form-input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>
          {t(isPending ? "common.saving" : "common.save")}
        </button>
        <button className="cfg-field__reset" onClick={onCancel} disabled={isPending} aria-label={t("common.cancel")}>
          ✕
        </button>
      </div>
    );
  }

  // 프로바이더 인스턴스 선택 필드 → InstancePicker
  const instance_picker_purpose = INSTANCE_PICKER_FIELDS[field.path];
  if (instance_picker_purpose) {
    return (
      <InstancePicker
        purpose={instance_picker_purpose}
        draft={draft}
        setDraft={setDraft}
        onCommit={onCommit}
        onCancel={onCancel}
        isPending={isPending}
      />
    );
  }

  // 모델 선택 필드 → ModelPicker (페어링된 인스턴스 값에서 모델 목록 조회)
  const model_pair = MODEL_PICKER_PAIRS[field.path];
  if (model_pair && sectionFields) {
    const instance_field = sectionFields.find((f) => f.path === model_pair);
    const instance_id = instance_field ? String(instance_field.value ?? "") : "";
    return (
      <ModelPicker
        instanceId={instance_id}
        draft={draft}
        setDraft={setDraft}
        onCommit={onCommit}
        onCancel={onCancel}
        isPending={isPending}
      />
    );
  }

  return (
    <div className="cfg-edit-row">
      <input
        className="form-input"
        type={field.sensitive ? "password" : field.type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={on_key}
        placeholder={field.sensitive ? t("settings.enter_new_value") : String(field.default_value ?? "")}
        autoFocus
        disabled={isPending}
      />
      <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>
        {t(isPending ? "common.saving" : "common.save")}
      </button>
      <button className="cfg-field__reset" onClick={onCancel} disabled={isPending} aria-label={t("common.cancel")}>
        ✕
      </button>
    </div>
  );
}

/** 인스턴스 선택이 필요한 필드 → purpose 매핑 */
const INSTANCE_PICKER_FIELDS: Record<string, string> = {
  "embedding.instanceId": "embedding",
  "orchestration.orchestratorProvider": "chat",
  "orchestration.executorProvider": "chat",
};

/** 모델 선택 필드 → 페어링된 인스턴스 필드 path */
const MODEL_PICKER_PAIRS: Record<string, string> = {
  "embedding.model": "embedding.instanceId",
  "orchestration.orchestratorModel": "orchestration.orchestratorProvider",
  "orchestration.executorModel": "orchestration.executorProvider",
};

interface ProviderInstanceInfo {
  instance_id: string;
  label: string;
  provider_type: string;
  connection_id: string;
  model: string;
  available: boolean;
}

function InstancePicker({
  purpose, draft, setDraft, onCommit, onCancel, isPending,
}: {
  purpose: string;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const t = useT();
  const [instances, setInstances] = useState<ProviderInstanceInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=${purpose}`)
      .then((data) => { if (!cancelled) setInstances(data); })
      .catch(() => { if (!cancelled) setInstances([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [purpose]);

  return (
    <div className="cfg-edit-row cfg-edit-row--col">
      <div className="cfg-edit-row">
        <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>
          {t(isPending ? "common.saving" : "common.save")}
        </button>
        <button className="cfg-field__reset" onClick={onCancel} disabled={isPending} aria-label={t("common.cancel")}>
          ✕
        </button>
      </div>
      {loading && <div className="text-xs text-muted">{t("common.loading")}</div>}
      {!loading && instances.length > 0 && (
        <div className="instance-picker__list">
          <button
            type="button"
            className={`instance-picker__item${!draft ? " instance-picker__item--selected" : ""}`}
            onClick={() => setDraft("")}
          >
            <span className="instance-picker__id">{t("settings.instance_auto")}</span>
            <span className="instance-picker__meta">{t("settings.instance_auto_desc")}</span>
          </button>
          {instances.map((inst) => (
            <button
              key={inst.instance_id}
              type="button"
              className={`instance-picker__item${draft === inst.instance_id ? " instance-picker__item--selected" : ""}`}
              onClick={() => setDraft(inst.instance_id)}
            >
              <span className="instance-picker__id">{inst.label}</span>
              <span className="instance-picker__meta">
                {inst.provider_type}{inst.model ? ` / ${inst.model}` : ""}
                {!inst.available && ` (${t("common.unavailable")})`}
              </span>
            </button>
          ))}
        </div>
      )}
      {!loading && instances.length === 0 && (
        <div className="text-xs text-muted">{t("settings.no_instances")}</div>
      )}
    </div>
  );
}

interface ModelListItem {
  id: string;
  name: string;
  purpose: string;
  context_length?: number;
  pricing_input?: number;
  pricing_output?: number;
}

function ModelPicker({
  instanceId, draft, setDraft, onCommit, onCancel, isPending,
}: {
  instanceId: string;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const t = useT();
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!instanceId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 인스턴스 정보를 조회해서 connection_id 또는 provider_type으로 모델 목록 가져오기
    api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=chat`)
      .then((instances) => {
        const inst = instances.find((i) => i.instance_id === instanceId);
        if (!inst && !cancelled) { setModels([]); setLoading(false); return; }
        if (cancelled) return;
        // embedding 인스턴스도 시도
        if (!inst) {
          return api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=embedding`)
            .then((embed_instances) => {
              const e_inst = embed_instances.find((i) => i.instance_id === instanceId);
              if (!e_inst || cancelled) { setModels([]); setLoading(false); return; }
              return fetch_models_for_instance(e_inst, cancelled);
            });
        }
        return fetch_models_for_instance(inst, cancelled);
      })
      .catch(() => { if (!cancelled) { setModels([]); setLoading(false); } });

    function fetch_models_for_instance(inst: ProviderInstanceInfo, cancelled: boolean) {
      const url = inst.connection_id
        ? `/api/agents/connections/${encodeURIComponent(inst.connection_id)}/models`
        : `/api/agents/providers/models/${encodeURIComponent(inst.provider_type)}`;
      return api.get<ModelListItem[]>(url)
        .then((data) => { if (!cancelled) setModels(data); })
        .catch(() => { if (!cancelled) setModels([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [instanceId]);

  const q = search.toLowerCase();
  const filtered = q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : models;

  const on_key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) onCommit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="cfg-edit-row cfg-edit-row--col">
      <div className="cfg-edit-row">
        <input
          className="form-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={on_key}
          placeholder={t("settings.model_placeholder")}
          autoFocus
          disabled={isPending}
        />
        <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>
          {t(isPending ? "common.saving" : "common.save")}
        </button>
        <button className="cfg-field__reset" onClick={onCancel} disabled={isPending} aria-label={t("common.cancel")}>
          ✕
        </button>
      </div>
      {!instanceId && (
        <div className="text-xs text-muted">{t("settings.select_instance_first")}</div>
      )}
      {instanceId && loading && <div className="text-xs text-muted">{t("common.loading")}</div>}
      {instanceId && !loading && models.length > 0 && (
        <>
          <input
            className="instance-picker__model-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("settings.model_search")}
          />
          <div className="instance-picker__model-list">
            <button
              type="button"
              className={`instance-picker__model-item${!draft ? " instance-picker__model-item--selected" : ""}`}
              onClick={() => setDraft("")}
            >
              <span className="instance-picker__model-name">{t("settings.model_default")}</span>
              <span className="instance-picker__model-meta">{t("settings.model_default_desc")}</span>
            </button>
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`instance-picker__model-item${draft === m.id ? " instance-picker__model-item--selected" : ""}`}
                onClick={() => setDraft(m.id)}
              >
                <span className="instance-picker__model-name">{m.name || m.id}</span>
                {m.context_length && (
                  <span className="instance-picker__model-meta">{Math.round(m.context_length / 1000)}k</span>
                )}
              </button>
            ))}
          </div>
          {q && filtered.length === 0 && (
            <div className="text-xs text-muted">{t("settings.no_match")}</div>
          )}
        </>
      )}
      {instanceId && !loading && models.length === 0 && (
        <div className="text-xs text-muted">{t("settings.no_models")}</div>
      )}
    </div>
  );
}
