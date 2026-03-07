import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { CliAuthStatus, LoginResult } from "./types";

export function CliAuthSection() {
  const t = useT();
  const { toast } = useToast();

  const { data: statuses, refetch } = useQuery<CliAuthStatus[]>({
    queryKey: ["cli-auth-status"],
    queryFn: () => api.get("/api/auth/cli/status"),
    refetchInterval: 30_000,
  });

  const checkAll = useMutation({
    mutationFn: () => api.post<CliAuthStatus[]>("/api/auth/cli/check"),
    onSuccess: (data) => {
      void refetch();
      for (const s of data) {
        toast(`${s.cli}: ${s.authenticated ? t("cli_auth.authenticated") : t("cli_auth.not_authenticated")}`, s.authenticated ? "ok" : "err");
      }
    },
    onError: () => toast(t("providers.check_failed"), "err"),
  });

  const login = useMutation({
    mutationFn: (cli: string) => api.post<LoginResult>("/api/auth/cli/sessions", { cli }),
  });

  const cancel = useMutation({
    mutationFn: (cli: string) => api.del(`/api/auth/cli/sessions/${encodeURIComponent(cli)}`),
    onSuccess: () => { login.reset(); void refetch(); },
  });

  const loginResult = login.data;

  return (
    <div className="cli-auth-section">
      <div className="section-header">
        <h3>{t("cli_auth.title")}</h3>
        <button
          className="btn btn--sm"
          onClick={() => checkAll.mutate()}
          disabled={checkAll.isPending}
        >
          {checkAll.isPending ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      {!statuses?.length ? (
        <div className="empty-state"><div className="empty-state__icon">🤖</div><div className="empty-state__text">{t("cli_auth.no_agents")}</div></div>
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
            <button className="btn btn--sm" onClick={() => { login.reset(); void refetch(); }}>
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
