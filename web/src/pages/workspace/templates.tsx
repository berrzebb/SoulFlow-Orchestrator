import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { useAsyncAction } from "../../hooks/use-async-action";
import { SplitPane } from "./split-pane";
import { WsListItem, WsDetailHeader, WsSkeletonCol } from "./ws-shared";

interface TemplateEntry { name: string; exists: boolean }

export function TemplatesTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run_action = useAsyncAction();
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

  const save = () => {
    if (!selected) return Promise.resolve();
    return run_action(
      () => api.put(`/api/templates/${encodeURIComponent(selected!)}`, { content }).then(() => { setDirty(false); void qc.invalidateQueries({ queryKey: ["templates"] }); }),
      t("templates.saved_fmt", { name: selected }),
      t("templates.save_failed"),
    );
  };

  return (
    <SplitPane
      showRight={!!selected}
      left={
        <div className="ws-scroll">
          {templates.map((tmpl) => (
            <WsListItem key={tmpl.name} id={tmpl.name} active={selected === tmpl.name} onClick={() => setSelected(tmpl.name)} className="ws-item--spread">
              <span>{tmpl.name}.md</span>
              <Badge status={tmpl.exists ? "✓" : "—"} variant={tmpl.exists ? "ok" : "off"} />
            </WsListItem>
          ))}
        </div>
      }
      right={
        <div className="ws-col">
          <WsDetailHeader onBack={() => { setSelected(null); setDirty(false); }}>
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
          </WsDetailHeader>
          <div className="ws-col flex-fill">
            {!selected ? (
              <EmptyState icon="📝" title={t("templates.select")} />
            ) : loading ? (
              <WsSkeletonCol rows={["text", "text", "text-sm"]} />
            ) : (
              <textarea
                autoFocus
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
