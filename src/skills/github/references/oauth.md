# GitHub OAuth 설정

GitHub API를 `oauth_fetch`로 직접 호출하기 위한 OAuth Provider 설정.
`gh` CLI 인증과 독립적 — 두 방식 모두 사용 가능.

---

## 핵심 주의사항 — redirect_uri 일치

`start_auth` 호출 시 `redirect_uri`는 **브라우저가 대시보드에 접속한 실제 URL** 기준으로 자동 결정됩니다.

```
실제 접속 URL:  http://localhost:3000
→ redirect_uri: http://localhost:3000/api/oauth/callback
```

GitHub App에 등록한 **Authorization callback URL**이 이와 정확히 일치해야 합니다.

> `localhost`와 `127.0.0.1`은 GitHub에서 **별개 주소**로 취급합니다.
> 대시보드 접속 시 사용한 호스트명(localhost/127.0.0.1)과 포트를 그대로 사용하세요.

---

## 1. 대시보드 포트 확인

서버 시작 로그 또는 설정에서 대시보드 포트를 먼저 확인합니다.

```
예: Dashboard listening on http://localhost:3000
→ callback URL = http://localhost:3000/api/oauth/callback
```

---

## 2. GitHub OAuth App 생성

1. https://github.com/settings/developers → **OAuth Apps → New OAuth App**
2. 입력:
   - **Application name**: (임의)
   - **Homepage URL**: `http://localhost`
   - **Authorization callback URL**: `http://localhost:<실제_포트>/api/oauth/callback`
     ※ 위에서 확인한 포트와 호스트명을 그대로 사용
3. **Register application** → Client ID 확인, **Generate a new client secret** → 복사

---

## 3. 대시보드에서 연동 등록

대시보드(`http://localhost:<PORT>`) → **OAuth** 탭 → **새 연동 추가**:

| 필드 | 값 |
|------|-----|
| Service Type | `github` |
| Instance ID | `github` |
| Scopes | `repo read:user` (필요에 따라 추가) |
| Client ID | (위에서 복사) |
| Client Secret | (위에서 복사) |

→ **저장** → **인증 시작** → 브라우저에서 GitHub 승인 → 토큰 자동 저장

---

## redirect_uri 불일치 오류 해결

`The redirect_uri is not associated with this application` 오류 발생 시:

1. 브라우저 주소창에서 현재 대시보드 접속 URL 확인 (예: `http://localhost:3000`)
2. GitHub App 설정 → **Authorization callback URL** 확인
3. 두 값의 `호스트명:포트`가 완전히 일치하는지 확인
   - `localhost` vs `127.0.0.1` 불일치 → 둘 중 하나로 통일
   - 포트 번호 불일치 → GitHub App에서 수정

---

## 4. 에이전트 사용법

```javascript
// GitHub API 직접 호출
oauth_fetch({
  service_id: "github",
  url: "https://api.github.com/repos/owner/repo/issues",
  method: "GET",
  headers: { "X-GitHub-Api-Version": "2022-11-28" }
})

// POST 예시 — 이슈 생성
oauth_fetch({
  service_id: "github",
  url: "https://api.github.com/repos/owner/repo/issues",
  method: "POST",
  body: { title: "Bug report", body: "...", labels: ["bug"] }
})
```

토큰 만료 시 자동 갱신 시도. GitHub는 `supports_refresh: false`이므로 만료 시 재인증 필요.

---

## `gh` CLI vs `oauth_fetch` 선택 기준

| 상황 | 방식 |
|------|------|
| PR/이슈/CI/릴리즈 — 표준 작업 | `gh` CLI (`exec`) |
| 서브커맨드가 없는 API 엔드포인트 | `oauth_fetch` 또는 `gh api` |
| 대용량 JSON 응답 파싱·필터링 | `gh api --jq` |
| 웹훅/앱 설정 등 관리 API | `oauth_fetch` |

> `gh` CLI가 있다면 `gh api`로도 대부분 처리 가능. `oauth_fetch`는 `gh`가 없거나 세밀한 헤더 제어가 필요할 때 사용.
