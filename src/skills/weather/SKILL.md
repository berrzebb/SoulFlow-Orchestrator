---
name: weather
description: Get current weather conditions and forecasts for any location using Open-Meteo API with KMA (Korea Meteorological Administration) data. No API key required. High-resolution 1.5km model for Korea. Use when the user asks about weather, temperature, rain, snow, humidity, wind, or forecasts. Do NOT use for historical weather data or climate analysis.
metadata:
  model: local
  tools:
    - exec
    - web_fetch
  triggers:
    - 날씨
    - 기온
    - weather
    - forecast
    - 비
    - 눈
    - 기상
    - 습도
    - 바람
  aliases:
    - 날씨
  homepage: https://open-meteo.com/en/docs/kma-api
---

# Weather

## Quick Reference

| Task | Command |
|------|---------|
| 서울 현재 날씨 | `web_fetch(url="https://api.open-meteo.com/v1/kma?latitude=37.57&longitude=126.98&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&timezone=Asia/Seoul")` |
| 서울 7일 예보 | `web_fetch(url="https://api.open-meteo.com/v1/kma?latitude=37.57&longitude=126.98&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Asia/Seoul")` |
| 도시 좌표 검색 | `web_fetch(url="https://geocoding-api.open-meteo.com/v1/search?name=부산&count=1&language=ko")` |

API 키 불필요. 한국 기상청(KMA) 고해상도 1.5km 모델 사용.

## API: Open-Meteo KMA

**Base URL**: `https://api.open-meteo.com/v1/kma`

### 필수 파라미터
- `latitude`, `longitude`: 좌표 (소수점)
- `timezone`: `Asia/Seoul` (한국)

### 현재 날씨 (`current=`)
temperature_2m, relative_humidity_2m, apparent_temperature, weather_code, wind_speed_10m, wind_direction_10m, precipitation

### 시간별 예보 (`hourly=`)
temperature_2m, precipitation, weather_code, wind_speed_10m, cloud_cover

### 일별 예보 (`daily=`)
weather_code, temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max, sunrise, sunset

## 주요 도시 좌표

| 도시 | 위도 | 경도 |
|------|------|------|
| 서울 | 37.57 | 126.98 |
| 부산 | 35.18 | 129.08 |
| 인천 | 37.46 | 126.71 |
| 대구 | 35.87 | 128.60 |
| 대전 | 36.35 | 127.39 |
| 광주 | 35.16 | 126.85 |
| 제주 | 33.50 | 126.53 |
| 도쿄 | 35.68 | 139.69 |
| 뉴욕 | 40.71 | -74.01 |
| 런던 | 51.51 | -0.13 |

## Weather Code → 한국어

| 코드 | 상태 |
|------|------|
| 0 | ☀️ 맑음 |
| 1-3 | 🌤️ 대체로 맑음 / ⛅ 구름 조금 / ☁️ 흐림 |
| 45, 48 | 🌫️ 안개 |
| 51-55 | 🌦️ 이슬비 |
| 61-65 | 🌧️ 비 (약/보통/강) |
| 66-67 | 🌨️ 진눈깨비 |
| 71-75 | ❄️ 눈 (약/보통/강) |
| 77 | 🌨️ 싸락눈 |
| 80-82 | 🌧️ 소나기 |
| 85-86 | ❄️ 눈소나기 |
| 95 | ⛈️ 뇌우 |
| 96-99 | ⛈️ 우박 동반 뇌우 |

## Workflow

1. 도시명 → 좌표 변환: 위 테이블에 없으면 Geocoding API로 검색.
2. `web_fetch`로 Open-Meteo KMA API 호출.
3. JSON 응답에서 weather_code를 한국어로 변환하여 보고.

## Geocoding (도시 좌표 검색)

알려지지 않은 도시는 Open-Meteo Geocoding API로 좌표를 조회:

```
https://geocoding-api.open-meteo.com/v1/search?name=도시명&count=1&language=ko
```

응답의 `results[0].latitude`, `results[0].longitude` 사용.
