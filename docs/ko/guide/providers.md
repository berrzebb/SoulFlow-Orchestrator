# 프로바이더 설정

대시보드 → **Providers** 페이지에서 에이전트 백엔드 인스턴스를 관리합니다.

## 프로바이더란?

프로바이더는 에이전트가 사용할 LLM 백엔드 인스턴스입니다. 하나의 프로바이더 타입(`claude_sdk`)으로 여러 인스턴스를 만들어 우선순위를 다르게 설정할 수 있습니다.

## 프로바이더 추가

1. **Providers 페이지** → `Add` 버튼 클릭
2. 폼 작성:

| 필드 | 설명 | 예시 |
|------|------|------|
| Provider Type | 백엔드 엔진 | `claude_sdk` |
| Instance ID | 고유 식별자 (자동 생성) | `claude_sdk` |
| Label | 표시 이름 | `Primary Claude` |
| Enabled | 활성화 여부 | ✓ |
| Priority | 높을수록 우선 선택 (0~100) | `10` |
| API Token | 해당 백엔드의 API 키 | `sk-ant-...` |
| Supported Modes | 지원 실행 모드 | `once`, `agent`, `task` |

3. `Add` 버튼으로 저장

## 연결 테스트

각 프로바이더 카드의 **Test** 버튼을 누르면 실제 API 호출로 연결을 확인합니다.

- ✅ 통과 — 정상 연결
- ❌ 실패 — 토큰 또는 네트워크 확인 필요

## 우선순위와 Fallback

우선순위(Priority)가 높은 인스턴스가 먼저 선택됩니다. 선택된 인스턴스의 CircuitBreaker가 `open` 상태이면 다음 인스턴스로 자동 전환됩니다.

```
Priority 90: claude_sdk (open → 차단)
Priority 50: claude_cli (closed → 선택됨)
Priority 10: openrouter (standby)
```

## CircuitBreaker 상태

| 상태 | 표시 | 의미 |
|------|------|------|
| `closed` | 표시 없음 | 정상 |
| `half_open` | ⚠ 주황 뱃지 | 복구 시도 중 |
| `open` | ✗ 빨간 뱃지 | 차단 중 (자동 Fallback) |

`open`은 일정 시간 후 자동으로 `half_open`을 거쳐 복구됩니다.

## 지원 모드

| 모드 | 설명 |
|------|------|
| `once` | 단발성 응답 |
| `agent` | Agent Loop (멀티턴 도구 실행) |
| `task` | Task Loop (단계형 장기 실행) |

특정 모드가 체크 해제된 프로바이더는 해당 모드에서 사용되지 않습니다.

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| `Test` 실패 | API 토큰 유효성 확인 |
| 서킷 브레이커 `open` 지속 | 토큰 갱신 후 Enable 토글 |
| 응답 없음 | 우선순위가 높은 인스턴스가 Enabled 상태인지 확인 |

## 관련 문서

→ [에이전트 시스템](../core-concepts/agents.md)
→ [대시보드 가이드](./dashboard.md)
