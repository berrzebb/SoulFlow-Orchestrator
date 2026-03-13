/**
 * AuthService — 비밀번호 해싱(scrypt) + JWT 발급/검증(HS256).
 * 외부 패키지 없이 Node.js 내장 crypto만 사용한다.
 */

import { scryptSync, timingSafeEqual, randomBytes, createHmac } from "node:crypto";
import type { AdminStore } from "./admin-store.js";

const SCRYPT_N = 16384;   // CPU/메모리 비용 (2^14)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;
const JWT_ALG_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const JWT_EXPIRY_SEC = 7 * 24 * 60 * 60; // 7일

export interface JwtPayload {
  sub: string;    // user.id
  usr: string;    // user.username
  role: "superadmin" | "user";
  tid: string;    // team_id (default_team_id or "default")
  wdir: string;   // 사용자 workspace 상대 경로: tenants/<tid>/users/<sub>
  iat: number;
  exp: number;
}

function base64url_encode(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function base64url_decode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

export class AuthService {
  private readonly store: AdminStore;

  constructor(store: AdminStore) {
    this.store = store;
  }

  is_initialized(): boolean {
    return this.store.is_initialized();
  }

  // ── JWT 시크릿 (lazy init) ──

  private _get_jwt_secret(): string {
    let secret = this.store.get_setting("jwt_secret");
    if (!secret) {
      secret = randomBytes(48).toString("hex");
      this.store.set_setting("jwt_secret", secret);
    }
    return secret;
  }

  // ── 비밀번호 ──

  /** scrypt 해시 생성. 저장용. */
  hash_password(plain: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(plain, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `${salt}:${hash.toString("hex")}`;
  }

  /** 평문과 저장된 해시를 타이밍 안전하게 비교. */
  verify_password(plain: string, stored_hash: string): boolean {
    const [salt, hash_hex] = stored_hash.split(":");
    if (!salt || !hash_hex) return false;
    try {
      const expected = Buffer.from(hash_hex, "hex");
      const actual = scryptSync(plain, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
      if (actual.length !== expected.length) return false;
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // ── JWT ──

  /** HS256 JWT 발급. */
  sign_token(payload: Omit<JwtPayload, "iat" | "exp">): string {
    const now = Math.floor(Date.now() / 1000);
    const full: JwtPayload = { ...payload, iat: now, exp: now + JWT_EXPIRY_SEC };
    const body = base64url_encode(JSON.stringify(full));
    const signing_input = `${JWT_ALG_HEADER}.${body}`;
    const sig = createHmac("sha256", this._get_jwt_secret()).update(signing_input).digest("base64url");
    return `${signing_input}.${sig}`;
  }

  /**
   * JWT 검증 및 페이로드 반환.
   * 서명 불일치, 만료, 형식 오류 시 null 반환.
   */
  verify_token(token: string): JwtPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const signing_input = `${header}.${body}`;
    const expected_sig = createHmac("sha256", this._get_jwt_secret()).update(signing_input).digest("base64url");
    // 타이밍 안전 비교
    const sig_buf = Buffer.from(sig, "base64url");
    const expected_buf = Buffer.from(expected_sig, "base64url");
    if (sig_buf.length !== expected_buf.length) return null;
    if (!timingSafeEqual(sig_buf, expected_buf)) return null;

    try {
      const payload = JSON.parse(base64url_decode(body)) as JwtPayload;
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  // ── 초기 셋업 ──

  /**
   * 최초 superadmin 계정 생성 + 즉시 로그인.
   * 이미 초기화된 경우 null 반환.
   */
  async setup_superadmin(username: string, password: string): Promise<{ token: string; payload: JwtPayload } | null> {
    if (this.store.is_initialized()) return null;
    this.store.ensure_team("default", "Default");
    const hash = this.hash_password(password);
    this.store.create_user({ username, password_hash: hash, system_role: "superadmin", default_team_id: "default" });
    return this.login(username, password);
  }

  // ── 사용자 관리 (AdminStore 위임) ──

  list_users() { return this.store.list_users(); }

  get_user_by_id(id: string) { return this.store.get_user_by_id(id); }

  get_user_by_username(username: string) { return this.store.get_user_by_username(username); }

  create_user(input: { username: string; password: string; system_role: "superadmin" | "user"; default_team_id?: string | null }) {
    const hash = this.hash_password(input.password);
    return this.store.create_user({ username: input.username, password_hash: hash, system_role: input.system_role, default_team_id: input.default_team_id });
  }

  assign_team(user_id: string, team_id: string): boolean {
    return this.store.update_user(user_id, { default_team_id: team_id });
  }

  list_teams() { return this.store.list_teams(); }

  ensure_team(id: string, name: string) { return this.store.ensure_team(id, name); }

  delete_user(id: string): boolean { return this.store.delete_user(id); }

  update_password(id: string, password: string): boolean {
    const hash = this.hash_password(password);
    return this.store.update_user(id, { password_hash: hash });
  }

  // ── 전역 프로바이더 (AdminStore 위임) ──

  list_shared_providers(enabled_only = false) { return this.store.list_shared_providers(enabled_only); }

  get_shared_provider(id: string) { return this.store.get_shared_provider(id); }

  create_shared_provider(input: Parameters<typeof this.store.create_shared_provider>[0]) {
    return this.store.create_shared_provider(input);
  }

  update_shared_provider(id: string, patch: Parameters<typeof this.store.update_shared_provider>[1]) {
    return this.store.update_shared_provider(id, patch);
  }

  delete_shared_provider(id: string): boolean { return this.store.delete_shared_provider(id); }

  // ── 팀 전환 ──

  /**
   * 기존 사용자 검증 없이 새 팀 컨텍스트로 JWT 재발급.
   * 멤버십 검증은 호출 측(route handler) 책임.
   */
  issue_token_for_team(user_id: string, team_id: string): { token: string; payload: JwtPayload } | null {
    const user = this.store.get_user_by_id(user_id);
    if (!user) return null;
    const wdir = `tenants/${team_id}/users/${user.id}`;
    const payload: Omit<JwtPayload, "iat" | "exp"> = {
      sub: user.id, usr: user.username, role: user.system_role, tid: team_id, wdir,
    };
    const token = this.sign_token(payload);
    return { token, payload: this.verify_token(token)! };
  }

  // ── 로그인 헬퍼 ──

  /**
   * username + password로 로그인 시도.
   * 성공 시 JWT 반환, 실패 시 null.
   */
  async login(username: string, password: string): Promise<{ token: string; payload: JwtPayload } | null> {
    const user = this.store.get_user_by_username(username);
    if (!user || !user.password_hash) return null;
    if (!this.verify_password(password, user.password_hash)) return null;

    this.store.update_user(user.id, { last_login_at: new Date().toISOString() });

    const tid = user.default_team_id || "default";
    const wdir = `tenants/${tid}/users/${user.id}`;
    const payload: Omit<JwtPayload, "iat" | "exp"> = {
      sub: user.id, usr: user.username, role: user.system_role, tid, wdir,
    };
    const token = this.sign_token(payload);
    const verified = this.verify_token(token)!;
    return { token, payload: verified };
  }
}
