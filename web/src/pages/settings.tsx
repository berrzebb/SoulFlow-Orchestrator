import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { EmptyState } from "../components/empty-state";
import { SearchInput } from "../components/search-input";
import { SectionHeader } from "../components/section-header";
import { ToggleSwitch } from "../components/toggle-switch";
import { useToast } from "../components/toast";
import { useT } from "../i18n";
import { useAuthUser, useAdminUsers, type AdminUserRecord } from "../hooks/use-auth";

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

const CHANNEL_SECTIONS = new Set(["slack", "discord", "telegram", "channel", "channel.streaming", "channel.grouping", "channel.dispatch", "channel.dedupe"]);

export default function SettingsPage() {
  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
    staleTime: 30_000,
  });
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const t = useT();
  const { data: auth_user } = useAuthUser();

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
      <SectionHeader title={t("settings.title")}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("settings.search")}
          onClear={() => setSearch("")}
          autoFocus
          className="section-header__search"
        />
      </SectionHeader>
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

      {auth_user?.role === "superadmin" && !search && (
        <UsersPanel />
      )}
      {filtered_sections.map((s) => (
        <SectionPanel key={s.id} section={s} />
      ))}
      {search && filtered_sections.length === 0 && (
        <EmptyState type="no-results" title={t("settings.no_match")} />
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

// ── Users Panel (superadmin 전용) ──────────────────────────────────────────

function UsersPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading } = useAdminUsers();
  const [form, setForm] = useState<{ open: boolean; username: string; password: string; role: "user" | "superadmin" }>({
    open: false, username: "", password: "", role: "user",
  });
  const [pw_target, setPwTarget] = useState<AdminUserRecord | null>(null);
  const [new_pw, setNewPw] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/api/admin/users", { username: form.username.trim(), password: form.password, role: form.role }),
    onSuccess: () => {
      toast("사용자 생성 완료", "ok");
      setForm({ open: false, username: "", password: "", role: "user" });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: unknown) => {
      const msg = (e as { body?: { error?: string } })?.body?.error;
      toast(msg === "username_taken" ? "이미 존재하는 아이디입니다." : "생성 실패", "err");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/users/${id}`),
    onSuccess: () => { toast("사용자 삭제 완료", "ok"); void qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: () => toast("삭제 실패", "err"),
  });

  const change_pw = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/users/${id}/password`, { password: new_pw }),
    onSuccess: () => { toast("비밀번호 변경 완료", "ok"); setPwTarget(null); setNewPw(""); },
    onError: () => toast("비밀번호 변경 실패", "err"),
  });

  return (
    <section className="panel mb-3">
      <div className="li-flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>사용자 관리</h2>
        <button className="btn btn--sm btn--primary" onClick={() => setForm((f) => ({ ...f, open: !f.open }))}>
          {form.open ? "취소" : "+ 추가"}
        </button>
      </div>

      {form.open && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", flexWrap: "wrap" }}>
            <input
              className="form-input" style={{ flex: "1 1 140px" }}
              placeholder="아이디" value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
            <input
              className="form-input" style={{ flex: "1 1 140px" }}
              type="password" placeholder="비밀번호 (6자 이상)" value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <select
              className="form-input" style={{ flex: "0 0 120px" }}
              value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "user" | "superadmin" }))}
            >
              <option value="user">user</option>
              <option value="superadmin">superadmin</option>
            </select>
            <button
              className="btn btn--sm btn--ok"
              disabled={!form.username || form.password.length < 6 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "생성 중..." : "생성"}
            </button>
          </div>
        </div>
      )}

      {pw_target && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", alignItems: "center" }}>
            <span className="text-xs text-muted">{pw_target.username} 비밀번호 변경</span>
            <input
              className="form-input" style={{ flex: "1" }}
              type="password" placeholder="새 비밀번호 (6자 이상)" value={new_pw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <button
              className="btn btn--sm btn--ok"
              disabled={new_pw.length < 6 || change_pw.isPending}
              onClick={() => change_pw.mutate(pw_target.id)}
            >
              변경
            </button>
            <button className="btn btn--sm" onClick={() => { setPwTarget(null); setNewPw(""); }}>취소</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="skeleton skeleton--row" />
      ) : (
        <div className="users-list">
          {users.map((u) => (
            <div key={u.id} className="users-list__item li-flex">
              <div className="users-list__info">
                <span className="users-list__name">{u.username}</span>
                <Badge status={u.system_role} variant={u.system_role === "superadmin" ? "warn" : "info"} />
                {u.last_login_at && (
                  <span className="text-xs text-muted">최근 로그인: {new Date(u.last_login_at).toLocaleDateString()}</span>
                )}
              </div>
              <div className="li-flex" style={{ gap: "6px" }}>
                <button className="btn btn--xs" onClick={() => { setPwTarget(u); setNewPw(""); }}>
                  비밀번호
                </button>
                <button
                  className="btn btn--xs btn--danger"
                  disabled={del.isPending}
                  onClick={() => { if (confirm(`'${u.username}' 삭제?`)) del.mutate(u.id); }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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
  const { data: instances = [], isLoading: loading } = useQuery({
    queryKey: ["provider-instances", purpose],
    queryFn: () => api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=${purpose}`),
    staleTime: 30_000,
  });

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
  const [search, setSearch] = useState("");

  const { data: models = [], isLoading: loading } = useQuery({
    queryKey: ["models-for-instance", instanceId],
    enabled: !!instanceId,
    staleTime: 60_000,
    queryFn: async () => {
      const chat_instances = await api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=chat`);
      let inst: ProviderInstanceInfo | undefined = chat_instances.find((i) => i.instance_id === instanceId);
      if (!inst) {
        const embed_instances = await api.get<ProviderInstanceInfo[]>(`/api/config/provider-instances?purpose=embedding`);
        inst = embed_instances.find((i) => i.instance_id === instanceId);
      }
      if (!inst) return [];
      const url = inst.connection_id
        ? `/api/agents/connections/${encodeURIComponent(inst.connection_id)}/models`
        : `/api/agents/providers/models/${encodeURIComponent(inst.provider_type)}`;
      return api.get<ModelListItem[]>(url);
    },
  });

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
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t("settings.model_search")}
            onClear={() => setSearch("")}
            className="instance-picker__model-search"
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
