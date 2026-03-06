import { useState } from "react";
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
      <div className="skeleton skeleton--row" />
      <div className="skeleton skeleton--row" />
      <div className="skeleton skeleton--row" />
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
          className="input input--sm section-header__search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.search") || "Search settings..."}
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
          <FieldCard key={f.path} field={f} />
        ))}
      </div>
    </section>
  );
}

function FieldCard({ field }: { field: FieldInfo }) {
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
          <EditInline field={field} draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => setEditing(false)} isPending={save.isPending} />
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
  field, draft, setDraft, onCommit, onCancel, isPending,
}: {
  field: FieldInfo;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  isPending: boolean;
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
