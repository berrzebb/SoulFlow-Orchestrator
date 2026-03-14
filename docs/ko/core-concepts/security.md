# 보안

SoulFlow는 인바운드 수집부터 에이전트 실행, 아웃바운드 전달까지 전체 메시지 라이프사이클에 걸쳐 심층 방어(Defense-in-Depth)를 구현합니다.

## 아키텍처 개요

```
인바운드                    실행                       아웃바운드
─────────────────────     ──────────────────────     ─────────────────────
미디어 보안 검사           승인 게이트 (HITL)          출력 새니타이저
민감정보 자동 Sealing      도구 레벨 시크릿 주입       시크릿 참조 마스킹
프라이빗 호스트 차단       샌드박스 정책               아웃바운드 중복 제거
웹훅 엣지 가드             파일시스템 격리              토큰 유출 가드
                          서브에이전트 격리            DLQ (실패 복구)
                                                     세션 레코딩
```

---

## 1. 시크릿 Vault

민감정보는 AES-256-GCM 인증 암호화로 저장됩니다. 에이전트는 평문을 볼 수 없으며, `{{secret:KEY_NAME}}` 참조만 전달받습니다.

### 동작 원리

1. **암호화**: 각 시크릿마다 고유한 12바이트 IV와 16바이트 인증 태그 생성
2. **토큰 형식**: `sv1.{iv}.{tag}.{ciphertext}` (base64url 인코딩)
3. **AAD 바인딩**: 시크릿 이름이 Additional Authenticated Data로 바인딩 — 변조 시 감지
4. **마스터 키**: 32바이트 랜덤, SQLite에 저장 (`runtime/security/secrets.db`)

### 명령어

```
/secret set MY_KEY sk-abc123     → 암호화 저장
/secret get MY_KEY               → 참조값 조회 (평문 X)
/secret reveal MY_KEY            → 실제 값 확인 (사용자에게만)
/secret list                     → 저장된 키 목록
/secret remove MY_KEY            → 삭제
/secret status                   → Vault 상태 확인
/secret encrypt <텍스트>          → 일회성 암호화 (저장 없음)
/secret decrypt <암호문>          → 일회성 복호화
```

### 플레이스홀더 해석

도구 실행 시 `{{secret:NAME}}` 참조가 적시에(just-in-time) 평문으로 해석됩니다. 해석 파이프라인:

1. `resolve_placeholders()` — `{{secret:*}}` 토큰 교체
2. `resolve_inline_secrets()` — `sv1.*` 베어 토큰도 복호화
3. `resolve_placeholders_with_report()` — 누락된 키 및 유효하지 않은 암호문 감사 보고

### 유지보수

- 자동 생성된 시크릿(`inbound.*` 접두사)은 TTL 기반으로 정리
- `runtime/security/secrets.db` 백업 필수 — 키 분실 시 복구 불가

---

## 2. 인바운드 자동 Sealing

메시지에 포함된 토큰/패스워드 패턴을 자동 감지하여 에이전트에 도달하기 전에 Seal합니다.

```
사용자: 이 키로 API 호출해줘 sk-abc123
  → SoulFlow가 sk-abc123 자동 감지
  → Vault에 암호화 저장
  → 에이전트는 {{secret:detected_1}} 형태로만 봄
```

탐지 패턴: OpenAI (`sk-`), Anthropic (`sk-ant-`), GitHub PAT (`ghp_`, `ghs_`), AWS 키 (`AKIA`, `ASIA`), Slack 토큰 (`xox[baprs]-`), Stripe 키, JWT (`eyJ...`), 개인 키, DB 연결 문자열 등.

---

## 3. 민감정보 자동 탐지 (Redaction)

Vault와 별도의 레이어로, 모든 텍스트에서 자격증명 패턴을 스캔하여 `[REDACTED]`로 대체합니다.

### 패턴 기반 탐지

사전 컴파일된 정규식으로 매칭:
- 개인 키 (`-----BEGIN ... PRIVATE KEY-----`)
- JWT, API 키 (OpenAI, Anthropic, GitHub, AWS, Stripe, Twilio, SendGrid, Telegram, Google, Azure)
- DB 연결 문자열 (MongoDB, PostgreSQL)

### 환경변수 기반 마스킹

시작 시 `process.env`에서 `token`, `api_key`, `secret`, `password`, `access_key`, `refresh_token`을 포함하는 키를 스캔합니다. 출력에서 해당 값과 정확히 일치하는 문자열을 마스킹합니다.

### 대입문 탐지

`API_KEY=sk-abc123` 또는 `token: ghp_xxx` 같은 패턴을 감지하여 값 부분을 교정합니다.

---

## 4. 출력 새니타이저

3단계 새니타이징으로 에이전트 출력에서 유출된 내부 상태, 프로토콜, 자격증명을 제거합니다.

### Level 1: 최종 출력 (`sanitize_provider_output`)

제거 대상:
- 내부 도구 마샬링 블록 (`<ORCH_TOOL_CALLS>`)
- 페르소나/ID 유출 (AGENTS.md, SOUL.md, HEART.md 내용)
- 셸 스크립트 블록
- 프로바이더 노이즈 (실행 모드 라벨, 재연결 메시지)
- 도구 프로토콜 단편 (`"tool_calls":`, `"id":"call_*"`)

### Level 2: 스트리밍 (`sanitize_stream_chunk`)

더 공격적 — 추가 필터:
- 민감한 셸 명령 (cd, grep, npm, cargo 등)
- 빈 줄 및 공백 노이즈
- 에이전트 자기소개 및 @멘션

### Level 3: 시크릿 마스킹

- `{{secret:*}}` 토큰 → `[SECRET]`
- `sv1.*` 암호문 → `[ENCRYPTED]`
- ANSI 터미널 색상 코드 제거
- HTML 태그 새니타이징 (`<script>`, `<iframe>` 제거; `<code>`, `<a>` 텍스트 변환)

---

## 5. 승인 워크플로우 (HITL)

위험하거나 민감한 도구 실행은 진행 전 사용자의 명시적 승인을 요구합니다.

### 흐름

```
에이전트가 도구 실행 요청
  → 게이트 대상 도구로 판별
  → 사용자에게 승인 요청 전송 (도구명, 파라미터, 컨텍스트)
  → 사용자 응답 (텍스트 또는 리액션)
  → 의사결정 파싱 → 승인 / 거부 / 보류 / 취소 / 질문
  → 승인 시: 도구 실행 후 결과를 에이전트 컨텍스트에 피드백
```

### 응답 방법

| 방법 | 예시 |
|------|------|
| 텍스트 | `y`, `yes`, `ok`, `승인`, `허용` (승인) / `n`, `no`, `거절`, `불가` (거부) |
| 리액션 | ✅👍 (승인) / ❌👎 (거부) / ⏸️⏳ (보류) |

### 신뢰도 점수

정규식 매칭 횟수로 점수를 매깁니다. 1위와 2위 결정 간의 차이가 신뢰도(0.1–1.0)를 결정합니다. 모호한 응답은 `unknown`으로 처리됩니다.

### 중복 방지

리액션 기반 승인은 서명 기반 중복 제거와 TTL 정리로 이중 처리를 방지합니다.

---

## 6. 미디어 보안

메시지에서 다운로드한 파일은 다중 보안 검사를 거칩니다.

| 검사 | 규칙 |
|------|------|
| 프라이빗 호스트 차단 | localhost, 10.x, 172.16–31.x, 192.168.x, 169.254.x, IPv6 루프백 거부 |
| 크기 제한 | 원격 파일당 최대 20 MB |
| 페치 타임아웃 | 15초 중단 |
| 확장자 화이트리스트 | 36개 허용 확장자 (이미지, 문서, 아카이브, 미디어) |
| 파일명 새니타이징 | 셸 메타문자 제거, 최대 120자 |
| 메시지당 제한 | 메시지당 최대 8개 파일 |
| 인증 격리 | Slack (Bearer 토큰), Telegram (봇 API), Discord (공개) — 채널별 인증 범위 분리 |

저장 경로: `workspace/runtime/inbound-files/{provider}/{timestamp}-{filename}`

---

## 7. 운영 안전성

### 아웃바운드 중복 제거

재시도 시 메시지 중복 전달을 방지합니다. 에이전트 응답은 `[instance_id, chat_id, thread_id, reply_to, trigger_message_id]`로 키를 생성하여 트리거 메시지당 단일 발송을 보장합니다.

### Dead Letter Queue

전달 실패 메시지는 SQLite(`runtime/dlq/dlq.db`)에 저장됩니다:
- 재시도 횟수, 에러 상세, 전체 메시지 내용
- 시간 기반 정리
- 채널별 재생(replay) 복구 기능

### 세션 레코딩

감사 및 메모리를 위한 이중 레이어 기록:
- **SQLite**: 메타데이터 포함 구조화된 채팅별 세션 (발신자, 타임스탬프, 도구 호출 수, 사용량)
- **일별 로그**: `[ISO_TIMESTAMP] [provider:chat_id:thread] ROLE(sender): text` 형식 플레인텍스트 적재

### 디스패치 재시도

- 토큰 버킷 레이트 리미터
- 지수 백오프 (base × 2^attempt, 상한선 적용)
- 재시도 불가 에러 바이패스: `invalid_auth`, `channel_not_found`, `permission_denied`

---

---

## 8. 강화된 보안 제어

채널 엣지, 실행, 아웃바운드 경계에 추가로 적용되는 강화 보안 제어입니다.

### 웹훅 엣지 가드

인바운드 웹훅 요청은 처리 파이프라인에 진입하기 전에 검증됩니다:

- **서명 검증**: Slack, Telegram, Discord 웹훅의 HMAC/토큰 방식으로 검증
- **SSRF 방지**: 신뢰할 수 없는 소스의 웹훅 URL은 프라이빗 호스트 차단 목록 대조 (미디어 보안 § 6과 동일 규칙)
- **재생 공격 방지**: 요청 타임스탬프 검사 — 5분 이전 요청 거절
- **레이트 게이트**: 웹훅 진입점에서 IP별 요청 속도 제한

### 아웃바운드 토큰 유출 가드

에이전트 도구 호출 출력을 통해 시크릿이 외부로 유출되지 않도록 방지합니다:

- 각 도구 실행 후 출력 결과를 시크릿 패턴으로 스캔 (§ 3과 동일 정규식 세트)
- 도구 결과 내 `{{secret:*}}` 참조는 에이전트 컨텍스트에 포함되기 전 재봉인
- 아웃바운드 메시지에서 `sv1.*` 암호문 제거

### 파일시스템 격리

CLI 기반 에이전트 백엔드(Claude Code, Codex CLI, Gemini CLI)는 제한된 파일시스템 접근으로 실행됩니다:

| 규칙 | 제한 |
|------|------|
| 읽기/쓰기 루트 | `/data` (워크스페이스) 및 `/agents` (인증 토큰)만 허용 |
| 상위 디렉토리 탐색 | 허용된 루트 외부의 `../` 경로 차단 |
| 심링크 팔로잉 | 허용된 루트 외부 경로에서 비활성화 |
| `/usr` 외부 실행 | 차단 — 에이전트가 임의 바이너리를 생성할 수 없음 |

### 도구 레벨 보안 정책

각 노드/도구 유형에는 다음을 제어하는 보안 정책이 포함됩니다:

| 정책 | 설명 |
|------|------|
| `requires_approval` | 실행 전 HITL 승인 강제 |
| `secret_injection` | 이 도구에서 `{{secret:*}}` 플레이스홀더 해석 여부 |
| `network_access` | 아웃바운드 네트워크 호출 허용 여부 |
| `filesystem_scope` | 워크스페이스에 대한 읽기 전용, 읽기/쓰기, 또는 접근 없음 |

정책은 도구 유형별로 정의되며 대시보드 → **Settings** → `security.toolPolicies`에서 재정의 가능합니다.

---

## 관련 문서

→ [에이전트](./agents.md)
→ [슬래시 커맨드 레퍼런스](../guide/slash-commands.md)
→ [메모리 시스템](./memory.md)
