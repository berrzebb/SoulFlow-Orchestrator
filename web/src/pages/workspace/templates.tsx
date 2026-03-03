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
    api.get<{ content: string | null }>(`/api/templates/${selected}`)
      .then((res) => { if (!cancelled) { setContent(res.content ?? ""); setDirty(false); } })
      .catch(() => { if (!cancelled) setContent(""); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    await api.put(`/api/templates/${selected}`, { content });
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
              style={{
                padding: "8px 14px", cursor: "pointer", fontSize: 12,
                background: selected === tmpl.name ? "var(--panel-elevated)" : "none",
                borderLeft: selected === tmpl.name ? "3px solid var(--accent)" : "3px solid transparent",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <span>{tmpl.name}.md</span>
              <Badge status={tmpl.exists ? "✓" : "—"} variant={tmpl.exists ? "ok" : "off"} />
            </div>
          ))}
        </div>
      }
      right={
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {selected ? (
                <>
                  <b>{selected}.md</b>
                  {dirty && <span style={{ color: "var(--warn)", marginLeft: 8, fontSize: 11 }}>● {t("templates.unsaved")}</span>}
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
                  color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12,
                  lineHeight: 1.6, padding: 14, outline: "none",
                }}
              />
            )}
          </div>
        </div>
      }
    />
  );
}
