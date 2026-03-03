# 보안 Vault

SoulFlow는 AES-256-GCM 암호화 기반의 Vault로 민감정보를 관리합니다. API 키, 토큰, 패스워드를 안전하게 저장하고, 에이전트에게는 참조값만 전달합니다.

## 핵심 원칙

- **에이전트는 평문을 보지 않는다** — 에이전트 컨텍스트에는 `{{secret:KEY_NAME}}` 형태의 참조만 전달
- **도구 실행 시 복호화** — 실제 값은 도구가 실행될 때만 사용
- **인바운드 자동 Sealing** — 메시지에 포함된 토큰/패스워드 패턴을 자동 감지하여 Vault에 저장

## 기본 사용법

```
/secret set MY_API_KEY sk-abc123          → 암호화 저장
/secret get MY_API_KEY                    → 참조값 조회 (평문 X)
/secret reveal MY_API_KEY                 → 실제 값 확인 (사용자에게만)
/secret list                              → 저장된 키 목록
/secret remove MY_API_KEY                 → 삭제
/secret status                            → Vault 상태 확인
```

## 즉시 암복호화

저장 없이 일회성으로 암복호화할 수 있습니다.

```
/secret encrypt <평문>    → 암호화된 값 반환
/secret decrypt <암호문>  → 복호화된 값 반환
```

## 인바운드 자동 Sealing

사용자가 메시지에 민감정보를 직접 포함시키면 자동으로 처리됩니다.

```
사용자: MY_API_KEY로 API 호출해줘 (sk-abc123)
  → SoulFlow가 sk-abc123을 자동 감지
  → Vault에 저장 및 참조값으로 대체
  → 에이전트는 {{secret:detected_1}} 형태로만 봄
```

## 에이전트에서의 참조

```
사용자: OPENAI_KEY를 헤더에 넣어서 API 호출해줘
  → 에이전트가 도구 실행 시 Vault에서 자동 복호화
  → 에이전트 응답/로그에는 평문 노출 없음
```

## 주의사항

- Vault 파일(`runtime/vault/vault.db`)은 백업 필수
- Vault 키를 분실하면 저장된 시크릿을 복구할 수 없음
- `/secret reveal`은 사용자의 명시적 요청 시에만 실행

## 관련 문서

→ [메모리 시스템](./memory.md)
→ [슬래시 커맨드 레퍼런스](../guide/slash-commands.md)
