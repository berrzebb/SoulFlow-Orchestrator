---
name: location
description: Generate map links for places, addresses, and points of interest. Use when the user mentions a location, asks for directions, or wants nearby recommendations (restaurants, cafes, etc.). Supports Google Maps, Kakao Map, and Naver Map.
tools:
  - map
  - web_fetch
triggers:
  - 지도
  - 위치
  - 장소
  - 주변
  - 근처
  - 주소
  - 길찾기
  - 식당
  - 카페
  - 맛집
  - 병원
  - 약국
  - location
  - map
  - directions
  - nearby
  - restaurant
aliases:
  - 지도
  - map
---

# Location

사용자가 장소, 주소, 위치 관련 질문을 하면 `map` 도구로 지도 링크를 생성합니다.

## 도구 사용법

### map 도구

```
map(location="장소명 또는 주소", provider="google|kakao|naver", label="표시 라벨")
```

- `provider` 기본값: `google`
- 한국 장소는 `kakao` 또는 `naver` 권장
- 해외 장소는 `google` 권장

### 지도 제공자 선택 기준

| 상황 | 제공자 |
|------|--------|
| 한국 내 장소 (기본) | kakao |
| 한국 내 길찾기/교통 | naver |
| 해외 장소 | google |
| 사용자가 특정 제공자 요청 | 요청대로 |

## Workflow

1. 사용자 메시지에서 장소명/주소를 추출
2. 한국 장소면 `kakao`, 해외면 `google` 선택
3. `map` 도구로 링크 생성
4. 여러 장소를 추천할 때는 각각에 대해 `map` 도구를 호출하여 링크 목록 제공

## 주변 추천 요청 시

사용자가 "주변 식당", "근처 카페" 등을 요청하면:
1. 사용자가 언급한 기준 위치를 파악
2. 해당 지역의 대표적인 장소를 추천 (일반 상식 기반)
3. 각 추천 장소에 `map` 도구로 지도 링크를 첨부
4. 필요 시 `web_fetch`로 추가 정보 조회
