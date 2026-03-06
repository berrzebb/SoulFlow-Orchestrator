import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";

interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
}

interface ModelInfo {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  parameter_size?: string;
  quantization_level?: string;
}

interface RunningModelInfo {
  name: string;
  size: number;
  size_vram: number;
  expires_at: string;
}

interface RuntimeStatus {
  enabled: boolean;
  running: boolean;
  engine?: string;
  container: string;
  model: string;
  port: number;
  api_base: string;
  last_error?: string;
  model_loaded?: boolean;
  gpu_percent?: number;
}

function fmt_size(bytes: number): string {
  if (bytes <= 0) return "-";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

export function ModelsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [pullName, setPullName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [pulling, setPulling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { data: runtime, isLoading: runtimeLoading } = useQuery<RuntimeStatus>({
    queryKey: ["models-runtime"],
    queryFn: () => api.get("/api/models/runtime"),
    refetchInterval: 10_000,
    staleTime: 4_000,
  });

  const { data: models, isLoading: modelsLoading } = useQuery<ModelInfo[]>({
    queryKey: ["models"],
    queryFn: () => api.get("/api/models"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: active } = useQuery<RunningModelInfo[]>({
    queryKey: ["models-active"],
    queryFn: () => api.get("/api/models/active"),
    refetchInterval: 10_000,
    staleTime: 4_000,
  });

  const startPull = async (name: string) => {
    if (pulling) return;
    setPulling(true);
    setPullProgress({ status: "connecting" });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        toast(t("models.pull_failed"), "err");
        setPullProgress(null);
        setPulling(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let errored = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6)) as PullProgress;
            setPullProgress(p);
            if (p.status === "done") break;
            if (p.status.startsWith("error") || p.error) { errored = true; break; }
          } catch { /* skip malformed */ }
        }
        if (errored) break;
      }
      if (errored) {
        toast(t("models.pull_failed"), "err");
      } else {
        toast(t("models.pull_complete"), "ok");
        setPullName("");
      }
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["models-active"] });
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast(t("models.pull_failed"), "err");
    } finally {
      setPullProgress(null);
      setPulling(false);
      abortRef.current = null;
    }
  };

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.del(`/api/models/${encodeURIComponent(name)}`),
    onSuccess: () => { toast(t("models.deleted"), "ok"); qc.invalidateQueries({ queryKey: ["models"] }); setDeleteTarget(null); },
    onError: () => toast(t("models.delete_failed"), "err"),
  });

  const switchMut = useMutation({
    mutationFn: (name: string) => api.patch("/api/models/runtime", { name }),
    onSuccess: () => { toast(t("models.switched"), "ok"); qc.invalidateQueries({ queryKey: ["models-runtime"] }); },
    onError: () => toast(t("models.switch_failed"), "err"),
  });

  if (runtimeLoading || modelsLoading) return (
    <div className="ws-skeleton-col">
      <div className="skeleton skeleton--card" />
      <div className="skeleton skeleton--row" />
      <div className="skeleton skeleton--row" />
      <div className="skeleton skeleton--row" />
    </div>
  );

  const runtimeStatus = runtime?.running ? t("models.running") : runtime?.enabled ? t("models.stopped") : t("models.disabled");
  const runtimeVariant = runtime?.running ? "ok" as const : runtime?.enabled ? "warn" as const : "off" as const;

  return (
    <div>
      <p className="text-xs text-muted mb-3">
        {t("models.description")}
      </p>

      {/* Runtime Status */}
      <section className="mb-4">
        <h3>{t("models.runtime_status")}</h3>
        <div className="card stat-grid p-3">
          <div>
            <span className="label">{t("models.status")}</span>
            <Badge status={runtimeStatus} variant={runtimeVariant} />
          </div>
          {runtime?.engine && (
            <div><span className="label">{t("models.engine")}</span> <span>{runtime.engine}</span></div>
          )}
          <div>
            <span className="label">{t("models.current_model")}</span>
            <span className="fw-600">{runtime?.model ?? "-"}</span>
          </div>
          {runtime?.gpu_percent != null && (
            <div>
              <span className="label">GPU</span>
              <div className="turn-bar gpu-bar ml-1" style={{ "--bar-w": `${Math.min(100, runtime.gpu_percent)}%`, "--bar-c": runtime.gpu_percent >= 90 ? "var(--err)" : runtime.gpu_percent >= 70 ? "var(--warn)" : "var(--ok)" } as React.CSSProperties}>
                <div className="turn-bar__fill" />
                <span className="turn-bar__label">{runtime.gpu_percent}%</span>
              </div>
            </div>
          )}
          {runtime?.last_error && (
            <div className="text-err grid-span-full">{runtime.last_error}</div>
          )}
        </div>
      </section>

      {/* Pull Model */}
      <section className="mb-4">
        <h3>{t("models.pull")}</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); if (pullName.trim()) startPull(pullName.trim()); }}
          className="pull-form"
        >
          <input
            className="input flex-fill"
            placeholder={t("models.pull_placeholder")}
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            disabled={pulling}
          />
          <button className="btn btn--primary" type="submit" disabled={pulling || !pullName.trim()}>
            {pulling ? t("models.pulling") : t("models.pull")}
          </button>
          {pulling && (
            <button className="btn btn--sm btn--danger" type="button" onClick={() => abortRef.current?.abort()}>
              {t("models.cancel")}
            </button>
          )}
        </form>
        {pullProgress && (
          <div className="pull-progress mt-2">
            <div className="pull-progress__header">
              <span>{pullProgress.status}</span>
              {pullProgress.total != null && pullProgress.total > 0 && (
                <span>{Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%</span>
              )}
            </div>
            {pullProgress.total != null && pullProgress.total > 0 && (
              <div className="pull-progress__track" style={{ "--bar-w": `${Math.min(100, ((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%` } as React.CSSProperties}>
                <div className={`pull-progress__fill${pullProgress.status.startsWith("error") ? " pull-progress__fill--err" : ""}`} />
              </div>
            )}
            {pullProgress.error && (
              <div className="text-xs text-err mt-1">{pullProgress.error}</div>
            )}
          </div>
        )}
      </section>

      {/* Installed Models */}
      <section className="mb-4">
        <h3>{t("models.installed")}</h3>
        {!models?.length ? (
          <div className="empty-state"><div className="empty-state__icon">🧠</div><div className="empty-state__text">{t("models.empty")}</div></div>
        ) : (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("models.size")}</th>
                <th>{t("models.params")}</th>
                <th>{t("models.quant")}</th>
                <th>{t("models.modified")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.digest}>
                  <td className={m.name === runtime?.model ? "fw-600" : ""}>
                    {m.name}
                    {m.name === runtime?.model && <Badge status="active" variant="ok" />}
                  </td>
                  <td>{fmt_size(m.size)}</td>
                  <td>{m.parameter_size ?? "-"}</td>
                  <td>{m.quantization_level ?? "-"}</td>
                  <td className="text-xs text-muted" title={m.modified_at}>{m.modified_at ? time_ago(m.modified_at) : "-"}</td>
                  <td className="li-flex">
                    {m.name !== runtime?.model && (
                      <button
                        className="btn btn--sm"
                        onClick={() => switchMut.mutate(m.name)}
                        disabled={switchMut.isPending}
                      >
                        {switchMut.isPending ? t("models.switching") : t("models.switch")}
                      </button>
                    )}
                    {deleteTarget === m.name ? (
                      <>
                        <button
                          className="btn btn--sm btn--danger"
                          onClick={() => deleteMut.mutate(m.name)}
                          disabled={deleteMut.isPending}
                        >
                          {deleteMut.isPending ? t("models.deleting") : t("common.confirm")}
                        </button>
                        <button className="btn btn--sm" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</button>
                      </>
                    ) : (
                      <button className="btn btn--sm btn--danger" onClick={() => setDeleteTarget(m.name)}>
                        {t("models.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {/* Active (VRAM Loaded) */}
      {active && active.length > 0 && (
        <section>
          <h3>{t("models.active")}</h3>
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("models.size")}</th>
                <th>{t("models.vram")}</th>
                <th>{t("models.expires")}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{fmt_size(m.size)}</td>
                  <td>{fmt_size(m.size_vram)}</td>
                  <td className="text-xs" title={m.expires_at}>{m.expires_at ? time_ago(m.expires_at) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
  );
}
