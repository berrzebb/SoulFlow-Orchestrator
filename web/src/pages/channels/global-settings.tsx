import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useT } from "../../i18n";
import { useAsyncAction } from "../../hooks/use-async-action";
import type { ConfigField, ConfigResponse } from "./types";

export function GlobalSettingsSection() {
  const t = useT();
  const qc = useQueryClient();
  const run_action = useAsyncAction();

  const { data } = useQuery<ConfigResponse>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
    staleTime: 30_000,
  });

  const sections = Array.isArray(data?.sections) ? data.sections : [];

  const get_value = (path: string): boolean => {
    for (const sec of sections) {
      const field = sec.fields?.find((f: ConfigField) => f.path === path);
      if (field) return Boolean(field.value);
    }
    return false;
  };

  const toggle = (path: string, current: boolean) =>
    run_action(
      () => api.put("/api/config/values", { path, value: !current }).then(() => { void qc.invalidateQueries({ queryKey: ["config"] }); }),
      undefined,
      t("channels.toggle_failed"),
    );

  const streaming = get_value("channel.streaming.enabled");
  const auto_reply = get_value("channel.autoReply");

  const settings = [
    {
      key: "channel.streaming.enabled",
      label: t("channels.stream_progress"),
      desc: t("channels.stream_progress_desc"),
      value: streaming,
    },
    {
      key: "channel.autoReply",
      label: t("channels.auto_reply"),
      desc: t("channels.auto_reply_desc"),
      value: auto_reply,
    },
  ];

  return (
    <section className="panel">
      <h2 className="mt-0 mb-3">{t("channels.global_settings")}</h2>
      <div className="stat-grid stat-grid--wide">
        {settings.map((s) => (
          <div key={s.key} className="settings-row">
            <div>
              <div className="settings-row__label">{s.label}</div>
              <div className="settings-row__desc">{s.desc}</div>
            </div>
            <ToggleSwitch checked={s.value} onChange={() => void toggle(s.key, s.value)} aria-label={s.label} />
          </div>
        ))}
      </div>
    </section>
  );
}
