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
  const { data: templates = [] } = useQuery<TemplateEntry[]>({ queryKey: ["templates"], queryFn: () => api.get("/api/templates") });

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api.post<{ content: string | null }>("/api/templates", { name: selected })
      .then((res) => { if (!cancelled) { setContent(res.content ?? ""); setDirty(false); } })
      .catch(() => { if (!cancelled) setContent(""); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    await api.put("/api/templates", { name: selected, content });
    toast(t("templates.saved_fmt", { name: selected }), "ok");
    setDirty(false);
    void qc.invalidateQueries({ queryKey: ["templates"] });
  };

  return (
    <SplitPane
      left={
        <div style={{ overflowY: "auto", flex: 1 }}>
          {templates.map((tmpl) => (
            <div
              key={tmpl.name}
              onClick={() => setSelected(tmpl.name)}
              className={`ws-item${selected === tmpl.name ? " ws-item--active" : ""}`}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span>{tmpl.name}.md</span>
              <Badge status={tmpl.exists ? "✓" : "—"} variant={tmpl.exists ? "ok" : "off"} />
            </div>
          ))}
        </div>
      }
      right={
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="ws-detail-header">
            <span className="fw-600" style={{ fontSize: "var(--fs-sm)" }}>
              {selected ? (
                <>
                  <b>{selected}.md</b>
                  {dirty && <span className="text-xs" style={{ color: "var(--warn)", marginLeft: "var(--sp-2)" }}>● {t("templates.unsaved")}</span>}
                </>
              ) : t("templates.select")}
            </span>
            {selected && (
              <button className="btn btn--sm btn--ok" onClick={() => void save()} disabled={!dirty}>{t("common.save")}</button>
            )}
          </div>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {!selected ? (
              <p className="empty">{t("templates.select")}</p>
            ) : loading ? (
              <p className="empty">{t("common.loading")}</p>
            ) : (
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                style={{
                  flex: 1, resize: "none", border: "none", background: "var(--bg)",
                  color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)",
                  lineHeight: 1.6, padding: "var(--sp-3)", outline: "none",
                }}
              />
            )}
          </div>
        </div>
      }
    />
  );
}
