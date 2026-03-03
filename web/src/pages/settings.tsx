import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
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
  });
  const [active, setActive] = useState<string | null>(null);

  const t = useT();

  if (isLoading || !data) return <p className="empty">{t("settings.loading")}</p>;

  const sections = (data.sections ?? []).filter((s) => !CHANNEL_SECTIONS.has(s.id));

  return (
    <div className="page">
      <h2>{t("settings.title")}</h2>
      <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginBottom: "var(--sp-4)" }}>
        {t("settings.description")}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--sp-4)" }}>
        <button
          className={`btn btn--sm ${!active ? "btn--primary" : ""}`}
          onClick={() => setActive(null)}
        >
          {t("settings.all")}
        </button>
        {sections.map((s) => (
          <button
            key={s.id}
            className={`btn btn--sm ${active === s.id ? "btn--primary" : ""}`}
            onClick={() => setActive(s.id)}
          >
            {t(`cfg.section.${s.id}`)}
            <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.6 }}>{s.fields.length}</span>
          </button>
        ))}
      </div>

      {sections
        .filter((s) => !active || s.id === active)
        .map((s) => (
          <SectionPanel key={s.id} section={s} />
        ))}
    </div>
  );
}

function SectionPanel({ section }: { section: SectionInfo }) {
  const t = useT();
  return (
    <section className="panel" style={{ marginBottom: "var(--sp-3)" }}>
      <h2>{t(`cfg.section.${section.id}`)}</h2>
      <div style={{ display: "grid", gap: 2 }}>
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
    mutationFn: () => api.del(`/api/config/values/${encodeURIComponent(field.path)}`),
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
    <div
      style={{
        display: "flex", alignItems: "center", gap: "var(--sp-3)",
        padding: "var(--sp-2) var(--sp-3)",
        borderRadius: "var(--radius-sm)",
        background: editing ? "rgba(74,158,255,0.04)" : "transparent",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!editing) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
      onMouseLeave={(e) => { if (!editing) e.currentTarget.style.background = "transparent"; }}
    >
      {/* Label + path + description */}
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{t(`cfg.${field.path}`)}</span>
          {field.restart_required && <Badge status={t("settings.restart")} variant="warn" />}
          {field.overridden && <Badge status={t("settings.override")} variant="info" />}
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--off)", marginTop: 1 }}>{field.path}</div>
        {field.description && (
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginTop: 2 }}>{t(`cfg.${field.path}.desc`)}</div>
        )}
      </div>

      {/* Value / Edit controls */}
      <div style={{ flex: "1 1 240px", minWidth: 120 }}>
        {editing ? (
          <EditInline field={field} draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => setEditing(false)} isPending={save.isPending} />
        ) : (
          <ValueDisplay field={field} onClick={start_edit} />
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {!editing && field.type !== "boolean" && (
          <button className="btn btn--xs" onClick={start_edit}>{t("common.edit")}</button>
        )}
        {!editing && field.overridden && (
          <button className="btn btn--xs btn--danger" onClick={() => reset.mutate()} disabled={reset.isPending}>
            {t("common.reset")}
          </button>
        )}
      </div>
    </div>
  );
}

function ValueDisplay({ field, onClick }: { field: FieldInfo; onClick: () => void }) {
  const t = useT();
  if (field.type === "boolean") {
    const on = field.value as boolean;
    return (
      <button
        onClick={onClick}
        aria-label={t("settings.toggle_field", { label: field.label })}
        style={{
          position: "relative", width: 36, height: 20, borderRadius: 10,
          border: "none", cursor: "pointer",
          background: on ? "var(--ok)" : "rgba(124,138,152,0.3)",
          transition: "background 0.2s",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </button>
    );
  }

  if (field.sensitive) {
    return (
      <span
        style={{ cursor: "pointer", color: field.sensitive_set ? "var(--text)" : "var(--off)", fontSize: "var(--fs-sm)" }}
        onClick={onClick}
        title={t("settings.click_to_edit")}
      >
        {field.sensitive_set ? "••••••••" : t("settings.not_set")}
      </span>
    );
  }

  if (field.type === "select") {
    const has_value = field.value !== undefined && field.value !== null && field.value !== "";
    return (
      <span
        onClick={onClick}
        title={t("settings.click_to_edit")}
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <span style={{
          fontSize: "var(--fs-xs)", fontFamily: "var(--font-mono)",
          background: "rgba(74,158,255,0.1)", color: "var(--accent)",
          border: "1px solid rgba(74,158,255,0.25)",
          borderRadius: 4, padding: "1px 6px",
        }}>
          {has_value ? String(field.value) : <span style={{ fontStyle: "italic", opacity: 0.5 }}>{t("settings.empty_value")}</span>}
        </span>
        <span style={{ fontSize: 9, color: "var(--muted)", opacity: 0.6 }}>▾</span>
      </span>
    );
  }

  return (
    <span
      style={{
        cursor: "pointer", fontSize: "var(--fs-sm)", fontFamily: "var(--font-mono)",
        color: field.value ? "var(--text)" : "var(--off)",
      }}
      onClick={onClick}
      title={t("settings.click_to_edit")}
    >
      {String(field.value ?? "") || <span style={{ fontStyle: "italic", color: "var(--off)" }}>{t("settings.empty_value")}</span>}
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
    if (e.key === "Enter") onCommit();
    if (e.key === "Escape") onCancel();
  };

  if (field.type === "select" && field.options) {
    return (
      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <select className="form-input" style={{ flex: 1, padding: "3px 8px" }} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>{t(isPending ? "common.saving" : "common.save")}</button>
        <button className="btn btn--xs" onClick={onCancel} disabled={isPending}>{t("common.cancel")}</button>
      </span>
    );
  }

  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input
        className="form-input"
        type={field.sensitive ? "password" : field.type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={on_key}
        placeholder={field.sensitive ? t("settings.enter_new_value") : String(field.default_value ?? "")}
        style={{ flex: 1, padding: "3px 8px", fontSize: "var(--fs-sm)" }}
        autoFocus
        disabled={isPending}
      />
      <button className="btn btn--xs btn--ok" onClick={onCommit} disabled={isPending}>{t(isPending ? "common.saving" : "common.save")}</button>
      <button className="btn btn--xs" onClick={onCancel} disabled={isPending}>{t("common.cancel")}</button>
    </span>
  );
}
