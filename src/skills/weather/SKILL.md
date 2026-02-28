---
name: weather
description: Get current weather conditions and forecasts for any location worldwide using free APIs (no API key required). Use when the user asks about weather, temperature, rain, snow, humidity, wind, or forecasts. Supports wttr.in (primary) and Open-Meteo (fallback JSON). Do NOT use for historical weather data or climate analysis.
metadata:
  model: local
  tools:
    - exec
  triggers:
    - 날씨
    - 기온
    - weather
    - forecast
    - 비
    - 눈
  aliases:
    - 날씨
  homepage: https://wttr.in/:help
---

# Weather

## Quick Reference

| Task | Command |
|------|---------|
| Quick weather | `curl -s "wttr.in/Seoul?format=3"` |
| Compact detail | `curl -s "wttr.in/Seoul?format=%l:+%c+%t+%h+%w"` |
| Full forecast | `curl -s "wttr.in/Seoul?T"` |
| JSON fallback | `curl -s "https://api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98&current_weather=true"` |

Two free services, no API keys needed.

## wttr.in (primary)

Format codes: `%c` condition · `%t` temp · `%h` humidity · `%w` wind · `%l` location · `%m` moon

Tips:
- URL-encode spaces: `wttr.in/New+York`
- Airport codes: `wttr.in/JFK`
- Units: `?m` (metric) `?u` (USCS)
- Today only: `?1` · Current only: `?0`

## Open-Meteo (fallback)

Free JSON API — find coordinates for a city, then query:

```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true"
```

Returns JSON with temp, windspeed, weathercode. Docs: https://open-meteo.com/en/docs
