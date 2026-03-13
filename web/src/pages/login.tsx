import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus, useLogin, type AuthUser } from "../hooks/use-auth";
import { api } from "../api/client";

export default function LoginPage() {
  const { data: auth_status, isLoading: status_loading } = useAuthStatus();

  if (status_loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="skeleton skeleton--row" style={{ height: 32 }} />
        </div>
      </div>
    );
  }

  if (auth_status && !auth_status.initialized) {
    return <SetupForm />;
  }

  return <LoginForm />;
}

/** 첫 실행: superadmin 계정 생성 폼. */
function SetupForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      api.post<{ ok: boolean; username: string; role: string }>("/api/auth/setup", creds),
    onSuccess: () => {
      qc.clear();
      void qc.prefetchQuery({
        queryKey: ["auth-me"],
        queryFn: async () => {
          try { return await api.get<AuthUser>("/api/auth/me"); }
          catch { return null; }
        },
      });
      navigate("/", { replace: true });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (password.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (username.trim().length < 2) { setError("아이디는 2자 이상이어야 합니다."); return; }
    setup.mutate({ username: username.trim(), password }, {
      onError: () => setError("설정에 실패했습니다. 다시 시도해주세요."),
    });
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-card__title">SoulFlow</h1>
        <p className="login-card__subtitle">첫 실행 — 관리자 계정을 생성합니다</p>

        {error && (
          <div className="login-card__error" role="alert">{error}</div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="setup-username">관리자 아이디</label>
          <input
            id="setup-username"
            className="form-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={setup.isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="setup-password">비밀번호 (6자 이상)</label>
          <input
            id="setup-password"
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={setup.isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="setup-confirm">비밀번호 확인</label>
          <input
            id="setup-confirm"
            className="form-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={setup.isPending}
          />
        </div>

        <button
          className="btn btn--primary btn--full"
          type="submit"
          disabled={setup.isPending || !username || !password || !confirm}
        >
          {setup.isPending ? "생성 중..." : "관리자 계정 생성"}
        </button>
      </form>
    </div>
  );
}

/** 일반 로그인 폼. */
function LoginForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useLogin();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username: username.trim(), password });
      navigate("/", { replace: true });
    } catch {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-card__title">SoulFlow</h1>
        <p className="login-card__subtitle">로그인이 필요합니다</p>

        {error && (
          <div className="login-card__error" role="alert">{error}</div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="login-username">아이디</label>
          <input
            id="login-username"
            className="form-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={login.isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="login-password">비밀번호</label>
          <input
            id="login-password"
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={login.isPending}
          />
        </div>

        <button
          className="btn btn--primary btn--full"
          type="submit"
          disabled={login.isPending || !username || !password}
        >
          {login.isPending ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
