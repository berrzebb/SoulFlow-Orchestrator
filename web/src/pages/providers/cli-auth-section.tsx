import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { SectionHeader } from "../../components/section-header";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { CliAuthStatus, LoginResult } from "./types";
import { useEffect, useRef, useState } from "react";

export function CliAuthSection() {
  const t = useT();
  const { toast } = useToast();

  const [pollingCli, setPollingCli] = useState<string | null>(null);
  const [polledResult, setPolledResult] = useState<LoginResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refetchRef = useRef<(() => void) | null>(null);

  const stop_polling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPollingCli(null);
  };

  useEffect(() => {
    if (!pollingCli) return;
    pollRef.current = setInterval(async () => {
      try {
        const result = await api.get<LoginResult>(`/api/auth/cli/sessions/${encodeURIComponent(pollingCli)}`);
        if (result.state === "url_ready" || result.state === "completed" || result.state === "failed") {
          setPolledResult(result);
          stop_polling();
          if (result.state === "completed") refetchRef.current?.();
        }
      } catch {
        stop_polling();
      }
    }, 2_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollingCli]);

  const { data: statuses, refetch } = useQuery<CliAuthStatus[]>({
    queryKey: ["cli-auth-status"],
    queryFn: () => api.get("/api/auth/cli/status"),
    refetchInterval: 30_000,
  });
  refetchRef.current = () => { void refetch(); };

  const checkAll = useMutation({
    mutationFn: () => api.post<CliAuthStatus[]>("/api/auth/cli/check"),
    onSuccess: (data) => {
      refetchRef.current?.();
      for (const s of data) {
        toast(`${s.cli}: ${s.authenticated ? t("cli_auth.authenticated") : t("cli_auth.not_authenticated")}`, s.authenticated ? "ok" : "err");
      }
    },
    onError: () => toast(t("providers.check_failed"), "err"),
  });

  const login = useMutation({
    mutationFn: (cli: string) => api.post<LoginResult>("/api/auth/cli/sessions", { cli }),
    onSuccess: (result) => {
      if (result.state === "waiting_url") {
        setPolledResult(null);
        setPollingCli(result.cli);
      }
    },
  });

  const cancel = useMutation({
    mutationFn: (cli: string) => api.del(`/api/auth/cli/sessions/${encodeURIComponent(cli)}`),
    onSuccess: () => { login.reset(); setPolledResult(null); stop_polling(); refetchRef.current?.(); },
  });

  // 최신 로그인 결과: 폴링이 URL을 가져오면 우선 사용
  const loginResult = polledResult ?? login.data;

  return (
    <div className="cli-auth-section">
      <SectionHeader title={t("cli_auth.title")}>
        <button
          className="btn btn--sm"
          onClick={() => checkAll.mutate()}
          disabled={checkAll.isPending}
        >
          {checkAll.isPending ? t("common.loading") : t("common.refresh")}
        </button>
      </SectionHeader>

      {!statuses?.length ? (
        <EmptyState icon="🤖" title={t("cli_auth.no_agents")} />
      ) : (
        <div className="stat-grid stat-grid--wide">
          {statuses.map((s) => (
            <div key={s.cli} className={`stat-card desk--${s.authenticated ? "ok" : "warn"}`}>
              <div className="stat-card__header">
                <Badge status={s.cli === "claude" ? "Claude Code" : s.cli === "codex" ? "Codex CLI" : "Gemini CLI"} variant="info" />
                <Badge
                  status={s.authenticated ? t("cli_auth.authenticated") : t("cli_auth.not_authenticated")}
                  variant={s.authenticated ? "ok" : "warn"}
                />
              </div>
              <div className="stat-card__value stat-card__value--md">
                {s.account || s.cli}
              </div>
              {s.error && (
                <div className="stat-card__label text-warn">
                  {s.error}
                </div>
              )}
              {!s.authenticated && (
                <div className="mt-2">
                  <button
                    className="btn btn--sm btn--accent"
                    onClick={() => login.mutate(s.cli)}
                    disabled={login.isPending}
                  >
                    {t("cli_auth.login")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(loginResult?.state === "waiting_url" || pollingCli) && !loginResult?.login_url && (
        <div className="stat-card cli-auth-section__result">
          <p className="mb-2">
            <strong>{loginResult?.cli ?? pollingCli}</strong> — {t("cli_auth.waiting_url")}
          </p>
          <div className="cli-auth-section__actions">
            <button className="btn btn--sm" onClick={() => { cancel.mutate(loginResult?.cli ?? pollingCli ?? ""); }}>
              {t("cli_auth.cancel_login")}
            </button>
          </div>
        </div>
      )}

      {loginResult?.login_url && (
        <div className="stat-card cli-auth-section__result">
          <p className="mb-2">
            <strong>{loginResult.cli}</strong> — {t("cli_auth.open_url")}
          </p>
          <a
            className="cli-auth-section__url"
            href={loginResult.login_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {loginResult.login_url}
          </a>
          <div className="cli-auth-section__actions">
            <button className="btn btn--sm" onClick={() => cancel.mutate(loginResult.cli)}>
              {t("cli_auth.cancel_login")}
            </button>
            <button className="btn btn--sm" onClick={() => { login.reset(); setPolledResult(null); stop_polling(); refetchRef.current?.(); }}>
              {t("cli_auth.done")}
            </button>
          </div>
        </div>
      )}

      {loginResult?.state === "failed" && loginResult.error && (
        <div className="stat-card desk--err cli-auth-section__result">
          <p>{t("cli_auth.login_failed", { error: loginResult.error })}</p>
        </div>
      )}
    </div>
  );
}
