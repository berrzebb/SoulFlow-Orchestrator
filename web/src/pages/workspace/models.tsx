import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";

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
    refetchInterval: 5_000,
  });

  const { data: models, isLoading: modelsLoading } = useQuery<ModelInfo[]>({
    queryKey: ["models"],
    queryFn: () => api.get("/api/models"),
    refetchInterval: 10_000,
  });

  const { data: active } = useQuery<RunningModelInfo[]>({
    queryKey: ["models-active"],
    queryFn: () => api.get("/api/models/active"),
    refetchInterval: 5_000,
  });

  const startPull = useCallback(async (name: string) => {
    if (pulling) return;
    setPulling(true);
    setPullProgress({ status: "connecting" });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        toast(t("models.pull_failed"));
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
        toast(t("models.pull_failed"));
      } else {
        toast(t("models.pull_complete"));
        setPullName("");
      }
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["models-active"] });
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast(t("models.pull_failed"));
    } finally {
      setPullProgress(null);
      setPulling(false);
      abortRef.current = null;
    }
  }, [pulling, qc, toast, t]);

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.del("/api/models", { name }),
    onSuccess: () => { toast("Deleted"); qc.invalidateQueries({ queryKey: ["models"] }); setDeleteTarget(null); },
    onError: () => toast("Delete failed"),
  });

  const switchMut = useMutation({
    mutationFn: (name: string) => api.patch("/api/models/runtime", { name }),
    onSuccess: () => { toast("Model switched"); qc.invalidateQueries({ queryKey: ["models-runtime"] }); },
    onError: () => toast("Switch failed"),
  });

  if (runtimeLoading || modelsLoading) return <p className="empty">{t("models.loading")}</p>;

  const runtimeStatus = runtime?.running ? t("models.running") : runtime?.enabled ? t("models.stopped") : t("models.disabled");
  const runtimeVariant = runtime?.running ? "ok" as const : runtime?.enabled ? "warn" as const : "off" as const;

  return (
    <div>
      <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginBottom: "var(--sp-4)" }}>
        {t("models.description")}
      </p>

      {/* Runtime Status */}
      <section style={{ marginBottom: "var(--sp-6)" }}>
        <h3>{t("models.runtime_status")}</h3>
        <div className="card stat-grid" style={{ padding: "var(--sp-4)" }}>
          <div>
            <span className="label">Status</span>
            <Badge status={runtimeStatus} variant={runtimeVariant} />
          </div>
          {runtime?.engine && (
            <div><span className="label">{t("models.engine")}</span> <span>{runtime.engine}</span></div>
          )}
          <div>
            <span className="label">{t("models.current_model")}</span>
            <span style={{ fontWeight: 600 }}>{runtime?.model ?? "-"}</span>
          </div>
          {runtime?.gpu_percent != null && (
            <div><span className="label">GPU</span> <span>{runtime.gpu_percent}%</span></div>
          )}
          {runtime?.last_error && (
            <div style={{ gridColumn: "1 / -1", color: "var(--err)" }}>{runtime.last_error}</div>
          )}
        </div>
      </section>

      {/* Pull Model */}
      <section style={{ marginBottom: "var(--sp-6)" }}>
        <h3>{t("models.pull")}</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); if (pullName.trim()) startPull(pullName.trim()); }}
          style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--sp-2)", maxWidth: 480 }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
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
          <div style={{ marginTop: "var(--sp-2)", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-xs)", marginBottom: 4 }}>
              <span>{pullProgress.status}</span>
              {pullProgress.total != null && pullProgress.total > 0 && (
                <span>{Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%</span>
              )}
            </div>
            {pullProgress.total != null && pullProgress.total > 0 && (
              <div style={{ width: "100%", height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, ((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%`,
                    height: "100%",
                    background: pullProgress.status.startsWith("error") ? "var(--err)" : "var(--accent)",
                    transition: "width 0.3s ease",
                    borderRadius: 3,
                  }}
                />
              </div>
            )}
            {pullProgress.error && (
              <div style={{ color: "var(--err)", fontSize: "var(--fs-xs)", marginTop: 4 }}>{pullProgress.error}</div>
            )}
          </div>
        )}
      </section>

      {/* Installed Models */}
      <section style={{ marginBottom: "var(--sp-6)" }}>
        <h3>{t("models.installed")}</h3>
        {!models?.length ? (
          <p className="empty">{t("models.empty")}</p>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>{t("models.size")}</th>
                <th>Params</th>
                <th>Quant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.digest}>
                  <td style={{ fontWeight: m.name === runtime?.model ? 700 : 400 }}>
                    {m.name}
                    {m.name === runtime?.model && <Badge status="active" variant="ok" />}
                  </td>
                  <td>{fmt_size(m.size)}</td>
                  <td>{m.parameter_size ?? "-"}</td>
                  <td>{m.quantization_level ?? "-"}</td>
                  <td style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--sp-2)" }}>
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
                          {deleteMut.isPending ? t("models.deleting") : "Confirm"}
                        </button>
                        <button className="btn btn--sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
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
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>{t("models.size")}</th>
                <th>{t("models.vram")}</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{fmt_size(m.size)}</td>
                  <td>{fmt_size(m.size_vram)}</td>
                  <td>{m.expires_at ? new Date(m.expires_at).toLocaleString() : "-"}</td>
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
