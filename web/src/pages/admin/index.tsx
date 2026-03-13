import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { SectionHeader } from "../../components/section-header";
import { useToast } from "../../components/toast";
import {
  useAuthUser, useAdminUsers, useAdminTeams, useTeamMembers,
  useAddTeamMember, useRemoveTeamMember, useUpdateTeamMemberRole,
  useUpdateTeam, useDeleteTeam,
  type AdminUserRecord, type TeamRole,
} from "../../hooks/use-auth";
import { useResourceCRUD } from "../../hooks/use-resource-crud";
import { useToggleMutation } from "../../hooks/use-toggle-mutation";
import type { ChannelInstance } from "../channels/types";
import { MonitoringPanel } from "./monitoring-panel";

type AdminTab = "teams" | "users" | "providers" | "channels" | "monitoring";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "teams", label: "팀 관리" },
  { id: "users", label: "사용자 관리" },
  { id: "providers", label: "전역 프로바이더" },
  { id: "channels", label: "채널" },
  { id: "monitoring", label: "모니터링" },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const { data: auth_user, isLoading } = useAuthUser();
  const [tab, setTab] = useState<AdminTab>("teams");

  useEffect(() => {
    if (isLoading) return;
    if (!auth_user || auth_user.role !== "superadmin") navigate("/", { replace: true });
  }, [auth_user, isLoading, navigate]);

  if (isLoading || !auth_user) {
    return (
      <div className="page">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton skeleton--row" style={{ marginBottom: "12px" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <SectionHeader title="관리자 콘솔" />

      <div className="settings__filters" role="tablist" style={{ marginBottom: "16px" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`btn btn--sm ${tab === t.id ? "btn--primary" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "teams" && <TeamsPanel />}
      {tab === "users" && <UsersPanel />}
      {tab === "providers" && <GlobalProvidersPanel />}
      {tab === "channels" && <ChannelsPanel />}
      {tab === "monitoring" && <MonitoringPanel />}
    </div>
  );
}

// ── Teams Panel ───────────────────────────────────────────────────────────────

function TeamsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: teams = [], isLoading } = useAdminTeams();
  const [form, setForm] = useState({ open: false, id: "", name: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rename_target, set_rename_target] = useState<string | null>(null);
  const [rename_draft, set_rename_draft] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/api/admin/teams", { id: form.id.trim(), name: form.name.trim() }),
    onSuccess: () => {
      toast("팀 생성 완료", "ok");
      setForm({ open: false, id: "", name: "" });
      void qc.invalidateQueries({ queryKey: ["admin-teams"] });
    },
    onError: (e: unknown) => {
      const msg = (e as { body?: { error?: string } })?.body?.error;
      toast(msg === "id_must_be_lowercase_alphanumeric_hyphen" ? "ID는 소문자·숫자·하이픈만 허용" : "생성 실패", "err");
    },
  });

  const update_team = useUpdateTeam();
  const delete_team = useDeleteTeam();

  const start_rename = (t: { id: string; name: string }) => {
    set_rename_target(t.id);
    set_rename_draft(t.name);
  };

  const commit_rename = (id: string) => {
    if (!rename_draft.trim()) return;
    update_team.mutate({ id, name: rename_draft.trim() }, {
      onSuccess: () => { toast("팀 이름 변경 완료", "ok"); set_rename_target(null); },
      onError: () => toast("이름 변경 실패", "err"),
    });
  };

  const do_delete = (t: { id: string; name: string }) => {
    if (!confirm(`팀 '${t.name}'을 삭제하면 모든 멤버십과 팀 데이터가 삭제됩니다. 계속하시겠습니까?`)) return;
    delete_team.mutate(t.id, {
      onSuccess: () => toast("팀 삭제 완료", "ok"),
      onError: () => toast("팀 삭제 실패", "err"),
    });
  };

  return (
    <section className="panel mb-3">
      <div className="li-flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>팀 목록</h2>
        <button className="btn btn--sm btn--primary" onClick={() => setForm((f) => ({ ...f, open: !f.open }))}>
          {form.open ? "취소" : "+ 팀 추가"}
        </button>
      </div>

      {form.open && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", flexWrap: "wrap" }}>
            <input
              className="form-input" style={{ flex: "1 1 120px" }}
              placeholder="ID (소문자·숫자·-)" value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            />
            <input
              className="form-input" style={{ flex: "1 1 160px" }}
              placeholder="팀 이름" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <button
              className="btn btn--sm btn--ok"
              disabled={!form.id || !form.name || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "생성 중..." : "생성"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="skeleton skeleton--row" />
      ) : (
        <div className="users-list">
          {teams.map((t) => (
            <div key={t.id}>
              <div className="users-list__item li-flex">
                <div className="users-list__info" style={{ flex: 1 }}>
                  {rename_target === t.id ? (
                    <div className="li-flex" style={{ gap: "6px" }}>
                      <input
                        className="form-input" style={{ flex: "1" }}
                        value={rename_draft}
                        onChange={(e) => set_rename_draft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commit_rename(t.id);
                          if (e.key === "Escape") set_rename_target(null);
                        }}
                        autoFocus
                      />
                      <button className="btn btn--xs btn--ok" disabled={!rename_draft.trim() || update_team.isPending} onClick={() => commit_rename(t.id)}>저장</button>
                      <button className="btn btn--xs" onClick={() => set_rename_target(null)}>취소</button>
                    </div>
                  ) : (
                    <>
                      <span className="users-list__name">{t.name}</span>
                      <span className="text-xs text-muted">ID: {t.id}</span>
                      <Badge status={`${t.member_count ?? 0}명`} variant="info" />
                    </>
                  )}
                </div>
                {rename_target !== t.id && (
                  <div className="li-flex" style={{ gap: "6px" }}>
                    <button className="btn btn--xs" onClick={() => setExpanded((prev) => prev === t.id ? null : t.id)}>
                      {expanded === t.id ? "접기" : "멤버"}
                    </button>
                    <button className="btn btn--xs" onClick={() => start_rename(t)}>이름 변경</button>
                    <button
                      className="btn btn--xs btn--danger"
                      disabled={delete_team.isPending}
                      onClick={() => do_delete(t)}
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
              {expanded === t.id && <TeamMembersList team_id={t.id} />}
            </div>
          ))}
          {teams.length === 0 && (
            <p className="text-xs text-muted" style={{ padding: "8px 0" }}>팀이 없습니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

const ROLE_OPTIONS: TeamRole[] = ["owner", "manager", "member", "viewer"];
const ROLE_LABELS: Record<TeamRole, string> = { owner: "오너", manager: "매니저", member: "멤버", viewer: "뷰어" };

function TeamMembersList({ team_id }: { team_id: string }) {
  const { toast } = useToast();
  const { data: allUsers = [] } = useAdminUsers();
  const { data: members = [], isLoading } = useTeamMembers(team_id);
  const add = useAddTeamMember(team_id);
  const remove = useRemoveTeamMember(team_id);
  const update_role = useUpdateTeamMemberRole(team_id);
  const [addForm, setAddForm] = useState({ open: false, user_id: "", role: "member" as TeamRole });

  const memberIds = new Set(members.map((m) => m.user_id));
  const available = allUsers.filter((u) => !memberIds.has(u.id));

  const submit_add = () => {
    add.mutate({ user_id: addForm.user_id, role: addForm.role }, {
      onSuccess: () => { toast("멤버 추가 완료", "ok"); setAddForm({ open: false, user_id: "", role: "member" }); },
      onError: () => toast("추가 실패", "err"),
    });
  };

  if (isLoading) return <div className="skeleton skeleton--row" style={{ margin: "4px 0" }} />;

  return (
    <div style={{ padding: "4px 16px 8px" }}>
      {members.map((m) => (
        <div key={m.user_id} className="li-flex" style={{ gap: "8px", padding: "3px 0", fontSize: "12px" }}>
          <span style={{ fontWeight: 500, minWidth: "80px" }}>{m.username ?? m.user_id}</span>
          <select
            className="form-input"
            style={{ fontSize: "11px", padding: "2px 4px", height: "24px", flex: "0 0 auto" }}
            value={m.role}
            disabled={update_role.isPending}
            onChange={(e) => update_role.mutate({ user_id: m.user_id, role: e.target.value as TeamRole }, {
              onSuccess: () => toast("역할 변경 완료", "ok"),
              onError: () => toast("역할 변경 실패", "err"),
            })}
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {m.system_role === "superadmin" && <Badge status="superadmin" variant="warn" />}
          <button
            className="btn btn--xs"
            style={{ color: "var(--err)", borderColor: "color-mix(in srgb, var(--err) 30%, transparent)", marginLeft: "auto" }}
            disabled={remove.isPending}
            onClick={() => remove.mutate(m.user_id, {
              onSuccess: () => toast("멤버 제거 완료", "ok"),
              onError: () => toast("제거 실패", "err"),
            })}
          >
            제거
          </button>
        </div>
      ))}
      {members.length === 0 && <p className="text-xs text-muted">멤버 없음</p>}

      {addForm.open ? (
        <div className="li-flex" style={{ gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
          <select className="form-input" style={{ flex: "1 1 140px" }} value={addForm.user_id}
            onChange={(e) => setAddForm((f) => ({ ...f, user_id: e.target.value }))}>
            <option value="">사용자 선택</option>
            {available.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select className="form-input" style={{ flex: "0 0 auto" }} value={addForm.role}
            onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as TeamRole }))}>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button className="btn btn--xs btn--ok" disabled={!addForm.user_id || add.isPending} onClick={submit_add}>추가</button>
          <button className="btn btn--xs" onClick={() => setAddForm((f) => ({ ...f, open: false }))}>취소</button>
        </div>
      ) : (
        <button className="btn btn--xs" style={{ marginTop: "6px" }}
          onClick={() => setAddForm((f) => ({ ...f, open: true }))}>
          + 멤버 추가
        </button>
      )}
    </div>
  );
}

// ── Users Panel ───────────────────────────────────────────────────────────────

function UsersPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading } = useAdminUsers();
  const { data: teams = [] } = useAdminTeams();
  const [form, setForm] = useState<{ open: boolean; username: string; password: string; role: "user" | "superadmin"; team_id: string }>({
    open: false, username: "", password: "", role: "user", team_id: "",
  });
  const [pw_target, setPwTarget] = useState<AdminUserRecord | null>(null);
  const [new_pw, setNewPw] = useState("");
  const [tm_target, setTmTarget] = useState<AdminUserRecord | null>(null);
  const [new_team, setNewTeam] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/api/admin/users", {
      username: form.username.trim(), password: form.password, role: form.role,
      team_id: form.team_id || null,
    }),
    onSuccess: () => {
      toast("사용자 생성 완료", "ok");
      setForm({ open: false, username: "", password: "", role: "user", team_id: "" });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["admin-teams"] });
    },
    onError: (e: unknown) => {
      const msg = (e as { body?: { error?: string } })?.body?.error;
      toast(msg === "username_taken" ? "이미 존재하는 아이디입니다." : "생성 실패", "err");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/users/${id}`),
    onSuccess: () => {
      toast("사용자 삭제 완료", "ok");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["admin-teams"] });
    },
    onError: () => toast("삭제 실패", "err"),
  });

  const change_pw = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/users/${id}/password`, { password: new_pw }),
    onSuccess: () => { toast("비밀번호 변경 완료", "ok"); setPwTarget(null); setNewPw(""); },
    onError: () => toast("비밀번호 변경 실패", "err"),
  });

  const change_team = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/users/${id}/team`, { team_id: new_team }),
    onSuccess: () => {
      toast("팀 변경 완료", "ok");
      setTmTarget(null); setNewTeam("");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["admin-teams"] });
    },
    onError: () => toast("팀 변경 실패", "err"),
  });

  const team_name = (id: string | null) => teams.find((t) => t.id === id)?.name ?? id ?? "—";

  return (
    <section className="panel mb-3">
      <div className="li-flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>사용자 목록</h2>
        <button className="btn btn--sm btn--primary" onClick={() => setForm((f) => ({ ...f, open: !f.open }))}>
          {form.open ? "취소" : "+ 추가"}
        </button>
      </div>

      {form.open && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", flexWrap: "wrap" }}>
            <input
              className="form-input" style={{ flex: "1 1 120px" }}
              placeholder="아이디" value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
            <input
              className="form-input" style={{ flex: "1 1 120px" }}
              type="password" placeholder="비밀번호 (6자 이상)" value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <select
              className="form-input" style={{ flex: "0 0 110px" }}
              value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "user" | "superadmin" }))}
            >
              <option value="user">user</option>
              <option value="superadmin">superadmin</option>
            </select>
            {teams.length > 0 && (
              <select
                className="form-input" style={{ flex: "0 0 130px" }}
                value={form.team_id} onChange={(e) => setForm((f) => ({ ...f, team_id: e.target.value }))}
              >
                <option value="">팀 없음</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <button
              className="btn btn--sm btn--ok"
              disabled={!form.username || form.password.length < 6 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "생성 중..." : "생성"}
            </button>
          </div>
        </div>
      )}

      {pw_target && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", alignItems: "center" }}>
            <span className="text-xs text-muted">{pw_target.username} 비밀번호 변경</span>
            <input
              className="form-input" style={{ flex: "1" }}
              type="password" placeholder="새 비밀번호 (6자 이상)" value={new_pw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <button
              className="btn btn--sm btn--ok"
              disabled={new_pw.length < 6 || change_pw.isPending}
              onClick={() => change_pw.mutate(pw_target.id)}
            >변경</button>
            <button className="btn btn--sm" onClick={() => { setPwTarget(null); setNewPw(""); }}>취소</button>
          </div>
        </div>
      )}

      {tm_target && (
        <div className="panel panel--inset mb-2">
          <div className="li-flex" style={{ gap: "8px", alignItems: "center" }}>
            <span className="text-xs text-muted">{tm_target.username} 팀 변경</span>
            <select
              className="form-input" style={{ flex: "1" }}
              value={new_team} onChange={(e) => setNewTeam(e.target.value)}
            >
              <option value="">팀 선택...</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              className="btn btn--sm btn--ok"
              disabled={!new_team || change_team.isPending}
              onClick={() => change_team.mutate(tm_target.id)}
            >변경</button>
            <button className="btn btn--sm" onClick={() => { setTmTarget(null); setNewTeam(""); }}>취소</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="skeleton skeleton--row" />
      ) : (
        <div className="users-list">
          {users.map((u) => (
            <div key={u.id} className="users-list__item li-flex">
              <div className="users-list__info">
                <span className="users-list__name">{u.username}</span>
                <Badge status={u.system_role} variant={u.system_role === "superadmin" ? "warn" : "info"} />
                {u.default_team_id && (
                  <Badge status={team_name(u.default_team_id)} variant="info" />
                )}
                {u.last_login_at && (
                  <span className="text-xs text-muted">최근 로그인: {new Date(u.last_login_at).toLocaleDateString()}</span>
                )}
              </div>
              <div className="li-flex" style={{ gap: "6px" }}>
                {teams.length > 0 && (
                  <button className="btn btn--xs" onClick={() => { setTmTarget(u); setNewTeam(u.default_team_id ?? ""); }}>
                    팀
                  </button>
                )}
                <button className="btn btn--xs" onClick={() => { setPwTarget(u); setNewPw(""); }}>
                  비밀번호
                </button>
                <button
                  className="btn btn--xs btn--danger"
                  disabled={del.isPending}
                  onClick={() => { if (confirm(`'${u.username}' 삭제?`)) del.mutate(u.id); }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Global Providers Panel ────────────────────────────────────────────────────

function GlobalProvidersPanel() {
  return (
    <section className="panel mb-3">
      <div style={{ marginBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>전역 프로바이더</h2>
        <p className="text-xs text-muted" style={{ marginTop: "4px" }}>모든 팀에서 공유하는 AI 프로바이더 관리는 프로바이더 페이지에서 수행합니다.</p>
      </div>
      <NavLink to="/providers" className="btn btn--sm btn--primary">
        프로바이더 관리 →
      </NavLink>
    </section>
  );
}
// ── Channels Panel ────────────────────────────────────────────────────────────

function ChannelsPanel() {
  const { toast } = useToast();

  const { items: instances, isLoading } = useResourceCRUD<ChannelInstance>({
    queryKey: ["channel-instances"],
    queryFn: () => api.get("/api/channels/instances"),
    deleteEndpoint: (id) => `/api/channels/instances/${encodeURIComponent(id)}`,
    onDeleteSuccess: () => toast("채널 삭제 완료", "ok"),
    onDeleteError: (err) => toast(`삭제 실패: ${err.message}`, "err"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const toggle_enabled = useToggleMutation<ChannelInstance>({
    queryKey: ["channel-instances"],
    getEndpoint: (id) => `/api/channels/instances/${encodeURIComponent(id)}`,
    idField: "instance_id",
    toggleField: "enabled",
    getErrMsg: (err) => `저장 실패: ${err.message}`,
  });

  const TYPE_LABELS: Record<string, string> = {
    slack: "Slack", discord: "Discord", telegram: "Telegram",
    line: "LINE", kakaotalk: "KakaoTalk",
  };

  return (
    <section className="panel mb-3">
      <div className="li-flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div>
          <h2 style={{ margin: 0 }}>채널 인스턴스</h2>
          <p className="text-xs text-muted" style={{ marginTop: "4px" }}>채널 상세 설정은 채널 페이지에서 관리</p>
        </div>
      </div>

      {isLoading ? (
        <div className="skeleton skeleton--row" />
      ) : (
        <div className="users-list">
          {instances.map((ch) => (
            <div key={ch.instance_id} className="users-list__item li-flex">
              <div className="users-list__info">
                <span className="users-list__name">{ch.label || ch.instance_id}</span>
                <Badge status={TYPE_LABELS[ch.provider] ?? ch.provider} variant="info" />
                {ch.enabled ? (
                  <Badge status="활성" variant="ok" />
                ) : (
                  <Badge status="비활성" variant="warn" />
                )}
              </div>
              <div className="li-flex" style={{ gap: "6px" }}>
                <button
                  className="btn btn--xs"
                  disabled={toggle_enabled.isPending}
                  onClick={() => toggle_enabled.mutate({ id: ch.instance_id, value: !ch.enabled })}
                >
                  {ch.enabled ? "비활성화" : "활성화"}
                </button>
              </div>
            </div>
          ))}
          {instances.length === 0 && (
            <p className="text-xs text-muted" style={{ padding: "8px 0" }}>채널이 없습니다. 채널 페이지에서 추가하세요.</p>
          )}
        </div>
      )}
    </section>
  );
}
