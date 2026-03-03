import { register_preset } from "../presets.js";

register_preset({
  service_type: "google",
  label: "Google",
  auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
  token_url: "https://oauth2.googleapis.com/token",
  scopes_available: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly"],
  default_scopes: ["openid", "email", "profile"],
  supports_refresh: true,
  is_builtin: true,
  test_url: "https://www.googleapis.com/oauth2/v2/userinfo",
  extra_auth_params: { access_type: "offline", prompt: "consent" },
});
