# web_browser 레퍼런스

## 명령어 전체 목록

| 명령 | 용도 | 예시 |
|------|------|------|
| `open` | URL 열기 | `web_browser(action="open", url="https://...")` |
| `snapshot` | 현재 페이지 상태 캡처 (텍스트) | `web_browser(action="snapshot")` |
| `screenshot` | 현재 페이지 이미지 캡처 | `web_browser(action="screenshot")` |
| `click` | 요소 클릭 | `web_browser(action="click", selector="button#submit")` |
| `fill` | 입력 필드 값 입력 | `web_browser(action="fill", selector="input[name=q]", value="검색어")` |
| `wait` | 요소 나타날 때까지 대기 | `web_browser(action="wait", selector=".result", timeout=5000)` |
| `close` | 브라우저 세션 종료 | `web_browser(action="close")` |

## 일반 워크플로우

```
# 1. 페이지 열기
web_browser(action="open", url="https://example.com")

# 2. 상태 확인
web_browser(action="snapshot")

# 3. 인터랙션
web_browser(action="click", selector="a.login")
web_browser(action="fill", selector="#username", value="user")
web_browser(action="fill", selector="#password", value="pass")
web_browser(action="click", selector="button[type=submit]")

# 4. 결과 대기 후 캡처
web_browser(action="wait", selector=".dashboard", timeout=5000)
web_browser(action="snapshot")

# 5. 세션 종료
web_browser(action="close")
```

## Selector 가이드

| 유형 | 예시 |
|------|------|
| ID | `#element-id` |
| Class | `.class-name` |
| 태그 | `button`, `input` |
| 속성 | `input[type=email]` |
| 복합 | `form#login button[type=submit]` |
| 텍스트 포함 | `button:has-text("로그인")` |

## 주의사항

- `open` 후 반드시 `snapshot`으로 상태 확인 — 로드 완료 여부 판단.
- 클릭 전 `snapshot`으로 selector 존재 확인.
- 세션은 작업 완료 후 반드시 `close` — 리소스 누수 방지.
- `screenshot`은 이미지 반환 — 텍스트 추출은 `snapshot` 사용.
