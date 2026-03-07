import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { SplitPane } from "./split-pane";

interface TemplateEntry { name: string; exists: boolean }

export function TemplatesTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates = [] } = useQuery<TemplateEntry[]>({ queryKey: ["templates"], queryFn: () => api.get("/api/templates"), staleTime: 30_000 });

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api.get<{ content: string | null }>(`/api/templates/${encodeURIComponent(selected!)}`)
      .then((res) => { if (!cancelled) { setContent(res.content ?? ""); setDirty(false); } })
      .catch(() => { if (!cancelled) { setContent(""); toast(t("templates.load_failed"), "err"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, toast, t]);

  const save = async () => {
    if (!selected) return;
    try {
      await api.put(`/api/templates/${encodeURIComponent(selected!)}`, { content });
      toast(t("templates.saved_fmt", { name: selected }), "ok");
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["templates"] });
    } catch {
      toast(t("templates.save_failed"), "err");
    }
  };

  return (
    <SplitPane
      showRight={!!selected}
      left={
        <div className="ws-scroll">
          {templates.map((tmpl) => (
            <div
              key={tmpl.name}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(tmpl.name)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(tmpl.name); } }}
              className={`ws-item ws-item--spread${selected === tmpl.name ? " ws-item--active" : ""}`}
            >
              <span>{tmpl.name}.md</span>
              <Badge status={tmpl.exists ? "✓" : "—"} variant={tmpl.exists ? "ok" : "off"} />
            </div>
          ))}
        </div>
      }
      right={
        <div className="ws-col">
          <div className="ws-detail-header">
            <button className="ws-back-btn" onClick={() => { setSelected(null); setDirty(false); }}>{t("common.back")}</button>
            <span className="fw-600 text-sm">
              {selected ? (
                <>
                  <b>{selected}.md</b>
                  {dirty && <span className="text-xs text-warn ml-1">● {t("templates.unsaved")}</span>}
                </>
              ) : t("templates.select")}
            </span>
            {selected && (
              <button className="btn btn--sm btn--ok" onClick={() => void save()} disabled={!dirty}>{t("common.save")}</button>
            )}
          </div>
          <div className="ws-col flex-fill">
            {!selected ? (
              <div className="empty-state"><div className="empty-state__icon">📝</div><div className="empty-state__text">{t("templates.select")}</div></div>
            ) : loading ? (
              <div className="ws-skeleton-col">
                <div className="skeleton skeleton--text" />
                <div className="skeleton skeleton--text" />
                <div className="skeleton skeleton--text-sm" />
              </div>
            ) : (
              <textarea
                className="ws-editor ws-editor--editing"
                value={content}
                onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              />
            )}
          </div>
        </div>
      }
    />
  );
}
