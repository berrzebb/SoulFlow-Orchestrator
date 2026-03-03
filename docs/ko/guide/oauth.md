# OAuth 연동

대시보드 **Workspace → OAuth 탭**에서 외부 서비스 OAuth 2.0 연동을 관리합니다.

## 지원 서비스

| 서비스 | service_type | 기본 스코프 |
|--------|-------------|------------|
| GitHub | `github` | `repo`, `read:user` |
| Google | `google` | `openid`, `email`, `profile` |
| Custom | `custom` | 사용자 정의 |

## 사전 준비

> **필수**: 대시보드 **Settings → `dashboard.publicUrl`** 에 외부에서 접근 가능한 공개 URL을 먼저 설정하세요.
> (예: `https://dashboard.example.com`)
> OAuth 서비스가 이 주소로 콜백을 보내므로, localhost나 내부 IP는 사용할 수 없습니다.

### GitHub OAuth App 생성

1. [github.com/settings/developers](https://github.com/settings/developers) 접속
2. **OAuth Apps** → **New OAuth App**
3. **Application name**: 원하는 이름 입력
4. **Homepage URL**: `https://your-domain.com` (dashboard.publicUrl 값)
5. **Authorization callback URL**: `https://your-domain.com/api/oauth/callback`
6. 생성 후 **Client ID**와 **Client Secret** 복사

### Google OAuth 클라이언트 생성

1. [console.cloud.google.com](https://console.cloud.google.com) 접속
2. **사용자 인증 정보** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
3. 애플리케이션 유형: **웹 애플리케이션**
4. **승인된 리디렉션 URI**: `https://your-domain.com/api/oauth/callback`
5. 생성 후 **클라이언트 ID**와 **클라이언트 보안 비밀** 복사

## 연동 추가

1. **Workspace → OAuth 탭** 접속
2. **Add** 버튼 클릭
3. **Service Type** 선택 (GitHub / Google / Custom)
4. **Label** 입력 (카드에 표시될 이름)
5. **Client ID** / **Client Secret** 입력
   - Custom 선택 시 **Auth URL** · **Token URL** 추가 입력 필요
6. 필요한 스코프 선택
7. **Add** 버튼으로 저장

## 연결(Connect)

추가된 카드에서 **Connect** 버튼을 클릭합니다.

1. OAuth 팝업 창이 열립니다
2. 해당 서비스에서 권한 승인
3. 콜백 성공 시 약 3초 후 카드 상태가 **Connected**로 변경

> 팝업이 차단될 경우: 브라우저 주소창의 팝업 차단 아이콘을 클릭하여 허용하세요.

## 카드 상태

| 상태 | 의미 |
|------|------|
| **Not Connected** (회색) | 아직 연결하지 않은 상태 |
| **Connected** (초록) | 유효한 토큰 보유 |
| **Expired** (노랑) | 토큰 만료 — Refresh 필요 |

## 토큰 관리

| 버튼 | 동작 |
|------|------|
| **Connect** | OAuth 팝업으로 신규 인증 |
| **Refresh** | Refresh Token으로 Access Token 갱신 |
| **Test** | 현재 토큰으로 API 호출 테스트 |
| **Edit** | 스코프 · 활성화 상태 수정 (service_type은 변경 불가) |
| **Remove** | 연동 삭제 (토큰 포함) |

## 에이전트에서 사용

연동된 OAuth 토큰은 에이전트 도구에서 `oauth:{instance_id}` 참조로 사용할 수 있습니다.

인스턴스 ID는 카드 하단의 작은 텍스트로 확인할 수 있습니다.

```
사용자: GitHub에서 내 이슈 목록 가져와줘
→ 에이전트가 oauth:github 토큰으로 GitHub API 호출

사용자: Google Drive에서 파일 목록 보여줘
→ 에이전트가 oauth:google 토큰으로 Google API 호출
```

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| 팝업 열리지 않음 | 브라우저 팝업 차단 해제 |
| Connect 후 Connected 안 됨 | Redirect URI 설정 확인, Client Secret 재확인 |
| Test 실패 | 토큰 만료 → Refresh 클릭, 또는 Re-Connect |
| Refresh 실패 | 서비스에서 Refresh Token 만료됨 → Re-Connect |

## 관련 문서

→ [대시보드 사용법](./dashboard.md)
→ [보안 Vault](../core-concepts/security.md)
