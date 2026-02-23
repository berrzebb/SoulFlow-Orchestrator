---
name: spotify-control
description: Control Spotify Desktop on Windows through local PowerShell commands. Supports launch, playback controls, open Spotify URI, play a specific track by query, and start recommended tracks from a seed query.
---

# Spotify Control Skill

Use this skill to control locally installed Spotify on Windows.

## Preconditions

- Run on Windows with Spotify Desktop installed.
- Execute actions through `scripts/spotify_control.ps1`.
- Return failures in `provider:reason` form.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action <action> [-AutoLaunch] [-Uri <spotify:...>] [-Query <text>] [-RecommendationLimit <1-20>]
```

## Supported Actions

- `launch`: Start Spotify Desktop if not already running.
- `play`: Send Spotify app command `play`.
- `pause`: Send Spotify app command `pause`.
- `toggle`: Send Spotify app command `play/pause`.
- `next`: Send Spotify app command `next-track`.
- `previous`: Send Spotify app command `previous-track`.
- `stop`: Send Spotify app command `stop`.
- `status`: Return running status and process metadata.
- `open-uri`: Open `spotify:` URI.
- `play-track`: Search a track by `-Query` and play top match.
- `recommend`: Find recommendations from `-Query` seed and play top recommendation.

## Notes

- Media actions target Spotify's own window via `WM_APPCOMMAND` (not global media keys).
- This prevents controlling active browser sessions (for example YouTube) by mistake.
- If Spotify has no resolvable window handle, the script fails with `spotify-control:spotify_window_not_found`.
- `-AutoLaunch` starts Spotify automatically for media control actions when it is not running.
- `play-track` and `recommend` try Spotify Web API first when `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set.
- If API credentials are missing or API search fails, the script falls back to `spotify:search:` URI mode.
- Script output is JSON so downstream agents can parse it reliably.

## Quick Examples

```powershell
# Launch Spotify
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action launch

# Next track (auto-launch if needed)
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action next -AutoLaunch

# Open playlist URI
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action open-uri -Uri "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"

# Play a specific track by query
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action play-track -Query "QWER 별의 하모니"

# Play a recommendation from a seed query
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action recommend -Query "QWER 별의 하모니" -RecommendationLimit 5

# Check running status
powershell -ExecutionPolicy Bypass -File skills/spotify-control/scripts/spotify_control.ps1 -Action status
```
