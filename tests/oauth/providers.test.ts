/**
 * OAuth provider 등록 파일 — github/google/spotify 프리셋 등록 검증.
 * 각 파일을 import하면 side-effect로 register_preset()이 호출됨.
 */
import { describe, it, expect } from "vitest";
import { get_preset } from "../../src/oauth/presets.js";

// side-effect import — import 시 register_preset() 호출됨
import "../../src/oauth/providers/github.js";
import "../../src/oauth/providers/google.js";
import "../../src/oauth/providers/spotify.js";

describe("GitHub OAuth 프리셋", () => {
  it("등록됨", () => {
    const preset = get_preset("github");
    expect(preset).not.toBeNull();
  });

  it("올바른 auth_url", () => {
    expect(get_preset("github")!.auth_url).toBe("https://github.com/login/oauth/authorize");
  });

  it("올바른 token_url", () => {
    expect(get_preset("github")!.token_url).toBe("https://github.com/login/oauth/access_token");
  });

  it("supports_refresh = false (GitHub)", () => {
    expect(get_preset("github")!.supports_refresh).toBe(false);
  });

  it("is_builtin = true", () => {
    expect(get_preset("github")!.is_builtin).toBe(true);
  });

  it("default_scopes 포함 확인", () => {
    const scopes = get_preset("github")!.default_scopes;
    expect(scopes).toContain("repo");
    expect(scopes).toContain("read:user");
  });

  it("test_url 포함", () => {
    expect(get_preset("github")!.test_url).toBe("https://api.github.com/user");
  });
});

describe("Google OAuth 프리셋", () => {
  it("등록됨", () => {
    expect(get_preset("google")).not.toBeNull();
  });

  it("supports_refresh = true (Google)", () => {
    expect(get_preset("google")!.supports_refresh).toBe(true);
  });

  it("extra_auth_params 포함 (offline access)", () => {
    const params = get_preset("google")!.extra_auth_params;
    expect(params).toBeDefined();
    expect(params!.access_type).toBe("offline");
  });

  it("openid scope 포함", () => {
    expect(get_preset("google")!.default_scopes).toContain("openid");
  });

  it("test_url 포함", () => {
    expect(get_preset("google")!.test_url).toContain("googleapis.com");
  });
});

describe("Spotify OAuth 프리셋", () => {
  it("등록됨", () => {
    expect(get_preset("spotify")).not.toBeNull();
  });

  it("token_auth_method = 'basic' (Spotify)", () => {
    expect(get_preset("spotify")!.token_auth_method).toBe("basic");
  });

  it("supports_refresh = true", () => {
    expect(get_preset("spotify")!.supports_refresh).toBe(true);
  });

  it("streaming scope 포함", () => {
    expect(get_preset("spotify")!.scopes_available).toContain("streaming");
  });

  it("test_url 포함", () => {
    expect(get_preset("spotify")!.test_url).toContain("spotify.com");
  });
});
