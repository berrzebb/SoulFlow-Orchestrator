import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogin } from "../hooks/use-auth";

export default function LoginPage() {
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
