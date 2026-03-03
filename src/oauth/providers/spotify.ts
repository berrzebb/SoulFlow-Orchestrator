import { register_preset } from "../presets.js";

register_preset({
  service_type: "spotify",
  label: "Spotify",
  auth_url: "https://accounts.spotify.com/authorize",
  token_url: "https://accounts.spotify.com/api/token",
  scopes_available: [
    "user-read-private", "user-read-email",
    "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
    "playlist-read-private", "playlist-read-collaborative", "playlist-modify-public", "playlist-modify-private",
    "user-library-read", "user-library-modify",
    "user-top-read", "user-read-recently-played",
    "streaming",
  ],
  default_scopes: ["user-read-private", "user-read-email", "user-read-playback-state"],
  supports_refresh: true,
  is_builtin: true,
  token_auth_method: "basic",
  test_url: "https://api.spotify.com/v1/me",
});
