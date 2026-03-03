# web_fetch 레퍼런스

## 기본 사용

```
web_fetch(url="https://example.com")
```

## 언제 사용하나

- HTML 정적 콘텐츠 추출 (뉴스 기사, 문서, 블로그)
- `web_search` 결과 URL의 본문 내용 확인
- API 문서, GitHub README, 공식 문서 페이지
- JSON/XML 엔드포인트 직접 호출

## 언제 사용하지 않나

- 로그인이 필요한 페이지 → `web_browser` 사용
- SPA / JS 렌더링 필수 페이지 → `web_browser` 사용
- 대용량 파일 다운로드

## 출력 처리 패턴

```
# 1. URL에서 핵심 정보 추출
result = web_fetch(url="...")
# → markdown으로 변환된 텍스트 반환

# 2. 복수 페이지 순차 수집
for url in candidate_urls:
    content = web_fetch(url=url)
    # 날짜, 제목, 핵심 사실 추출 후 누적
```

## 주의사항

- 반환값은 markdown 변환 텍스트 — 원본 HTML 아님.
- 일부 사이트는 봇 차단으로 빈 응답 → `web_browser`로 전환.
- 페이지 내 스크립트/스타일 제거됨 — 텍스트 콘텐츠만 추출.
