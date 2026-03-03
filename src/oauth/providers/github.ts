import { register_preset } from "../presets.js";

register_preset({
  service_type: "github",
  label: "GitHub",
  auth_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  scopes_available: ["repo", "read:user", "read:org", "gist"],
  default_scopes: ["repo", "read:user"],
  supports_refresh: false,
  is_builtin: true,
  test_url: "https://api.github.com/user",
});
