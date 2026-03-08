import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useT } from "../../i18n";
import { useAsyncAction } from "../../hooks/use-async-action";
import type { ConfigField, ConfigResponse } from "./types";

type FieldType = "boolean" | "number" | "select";

interface SettingRow {
  key: string;
  label: string;
  desc?: string;
  type: FieldType;
  options?: string[];
}

export function GlobalSettingsSection() {
  const t = useT();
  const qc = useQueryClient();
  const run_action = useAsyncAction();
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);

  const { data } = useQuery<ConfigResponse>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
    staleTime: 30_000,
  });

  const sections = Array.isArray(data?.sections) ? data.sections : [];

  const get_raw = (path: string): unknown => {
    for (const sec of sections) {
      const field = sec.fields?.find((f: ConfigField) => f.path === path);
      if (field) return field.value;
    }
    return undefined;
  };

  const save = (path: string, value: unknown) => {
    // 즉시 캐시 업데이트 — 서버 응답 전 UI 반영
    qc.setQueryData<ConfigResponse>(["config"], (old) => {
      if (!old) return old;
      return {
        ...old,
        sections: old.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) => (f.path === path ? { ...f, value } : f)),
        })),
      };
    });
    return run_action(
      async () => {
        await api.put("/api/config/values", { path, value });
        void qc.invalidateQueries({ queryKey: ["config"] });
      },
      undefined,
      t("channels.toggle_failed"),
    ).catch(() => {
      void qc.invalidateQueries({ queryKey: ["config"] }); // 실패 시 서버 값으로 복원
    });
  };

  const commit_edit = (key: string, type: FieldType) => {
    if (!editing || editing.key !== key) return;
    const val = type === "number" ? Number(editing.draft) : editing.draft;
    void save(key, val);
    setEditing(null);
  };

  const render_row = (s: SettingRow) => {
    const current = get_raw(s.key);
    const is_editing = editing?.key === s.key;

    return (
      <div key={s.key} className="settings-row">
        <div>
          <div className="settings-row__label">{s.label}</div>
          {s.desc && <div className="settings-row__desc">{s.desc}</div>}
        </div>
        {s.type === "boolean" ? (
          <ToggleSwitch checked={Boolean(current)} onChange={() => void save(s.key, !Boolean(current))} aria-label={s.label} />
        ) : is_editing ? (
          <div className="cfg-edit-row">
            {s.type === "select" ? (
              <select className="form-input" value={editing!.draft} onChange={(e) => setEditing({ key: s.key, draft: e.target.value })} autoFocus>
                {s.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="form-input"
                type="number"
                value={editing!.draft}
                onChange={(e) => setEditing({ key: s.key, draft: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commit_edit(s.key, s.type); if (e.key === "Escape") setEditing(null); }}
                autoFocus
              />
            )}
            <button className="btn btn--xs btn--ok" onClick={() => commit_edit(s.key, s.type)}>{t("common.save")}</button>
            <button className="cfg-field__reset" onClick={() => setEditing(null)} aria-label={t("common.cancel")}>✕</button>
          </div>
        ) : (
          <button
            className="cfg-value cfg-value--clickable cfg-value--mono"
            onClick={() => setEditing({ key: s.key, draft: String(current ?? "") })}
          >
            {String(current ?? "")}
          </button>
        )}
      </div>
    );
  };

  const global_settings: SettingRow[] = [
    { key: "channel.autoReply", label: t("channels.auto_reply"), desc: t("channels.auto_reply_desc"), type: "boolean" },
  ];

  const streaming_settings: SettingRow[] = [
    { key: "channel.streaming.enabled", label: t("channels.stream_progress"), desc: t("channels.stream_progress_desc"), type: "boolean" },
    { key: "channel.streaming.mode", label: t("channels.stream_mode"), type: "select", options: ["live", "status"] },
    { key: "channel.streaming.intervalMs", label: t("channels.stream_interval_ms"), type: "number" },
  ];

  const grouping_settings: SettingRow[] = [
    { key: "channel.grouping.enabled", label: t("channels.grouping_enabled"), desc: t("channels.grouping_enabled_desc"), type: "boolean" },
    { key: "channel.grouping.windowMs", label: t("channels.grouping_window_ms"), type: "number" },
    { key: "channel.grouping.maxMessages", label: t("channels.grouping_max_messages"), type: "number" },
  ];

  return (
    <section className="panel">
      <h2 className="mt-0 mb-3">{t("channels.global_settings")}</h2>
      <div className="stat-grid stat-grid--wide">
        {global_settings.map(render_row)}
      </div>

      <h3 className="mt-3 mb-2 text-sm fw-600">{t("channels.streaming_section")}</h3>
      <div className="stat-grid stat-grid--wide">
        {streaming_settings.map(render_row)}
      </div>

      <h3 className="mt-3 mb-2 text-sm fw-600">{t("channels.grouping_section")}</h3>
      <div className="stat-grid stat-grid--wide">
        {grouping_settings.map(render_row)}
      </div>
    </section>
  );
}
