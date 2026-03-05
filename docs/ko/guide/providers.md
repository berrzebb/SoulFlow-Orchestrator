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
| Supported Modes | 지원 실행 모드 | `once`, `agent`, `task`, `phase` |

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

## 백엔드 타입

| 백엔드 | 방식 | 특징 | 자동 Fallback |
|--------|------|------|---------------|
| `claude_sdk` | 네이티브 SDK | 빌트인 도구 루프 · 스트리밍 | → `claude_cli` |
| `claude_cli` | Headless CLI 래퍼 | 안정성 · 범용 | — |
| `codex_appserver` | 네이티브 AppServer | 병렬 실행 · 빌트인 도구 루프 | → `codex_cli` |
| `codex_cli` | Headless CLI 래퍼 | 샌드박스 모드 지원 | — |
| `gemini_cli` | Headless CLI 래퍼 | Gemini CLI 통합 | — |
| `openai_compatible` | OpenAI 호환 API | vLLM · Ollama · LM Studio · Together AI · Gemini 등 로컬/원격 모델 | — |
| `openrouter` | OpenRouter API | 멀티 모델 라우팅 · 100+ 모델 접근 | — |
| `container_cli` | 컨테이너 CLI 래퍼 | Docker/Podman 샌드박스 격리 실행 | — |

### Container CLI 백엔드

`container_cli`는 에이전트 하나를 Docker/Podman 컨테이너에서 격리 실행합니다. Pty(node-pty 호환) 인터페이스로 추상화되어 상위 레이어는 transport를 모릅니다.

**아키텍처**:
```
Orchestrator
  ├─ Gateway (경량 분류기 → 실행 경로 결정)
  ├─ AgentBus (에이전트 간 통신 · 권한 매트릭스)
  └─ ContainerPool (컨테이너 생명주기 관리)
       └─ Docker/Podman API
            ├─ butler 컨테이너
            ├─ implementer 컨테이너
            └─ reviewer 컨테이너
```

**컨테이너 보안**:

| 보안 수단 | 설정 |
|-----------|------|
| Linux capabilities | `--cap-drop ALL` |
| 권한 상승 차단 | `--security-opt no-new-privileges` |
| 루트 파일시스템 | `--read-only` |
| 실행 사용자 | `--user 1000:1000` |
| 프로세스 제한 | `--pids-limit 100` |
| 네트워크 | `--network none` — 에이전트의 유일한 외부 통신 경로는 Pty |
| 메모리 | `512m` 기본 제한 |

**에러 자동 복구**:

| 에러 유형 | 복구 전략 |
|----------|----------|
| Context overflow | 3단계: compaction → tool result truncation → give up |
| Auth error | Auth 프로파일 로테이션 → 전체 소진 시 모델 failover |
| Rate limit | 지수 백오프 |
| Crash | 컨테이너 재생성 |
| Failover | 프로파일 로테이션 → FailoverError throw |

**NDJSON 와이어 프로토콜**: 컨테이너와 orchestrator는 줄 단위 JSON(NDJSON)으로 통신합니다. `{"type":"complete"}` 이벤트가 턴의 끝을 표시합니다.

**Lane Queue**: 에이전트 실행 중 새 메시지 도착 시 3가지 모드로 처리:

| 모드 | 동작 | 용도 |
|------|------|------|
| `steer` | 실행 중 에이전트에 즉시 주입 | 긴급 지시, 방향 수정 |
| `followup` | 현재 턴 완료 후 다음 턴으로 큐잉 | 후속 질문, 추가 작업 |
| `collect` | 여러 메시지를 모아서 배치 전달 | 빠른 연속 입력 합치기 |

### Fallback 체인

`claude_sdk` → `claude_cli`, `codex_appserver` → `codex_cli` 자동 전환이 내장되어 있습니다. 네이티브 백엔드 실패 시 CLI 래퍼로 자동 전환되며, `backend_fallback` 로그로 확인할 수 있습니다.

## 지원 모드

| 모드 | 설명 |
|------|------|
| `once` | 단발성 응답 — 단일 API 호출로 충분한 단순 질의 |
| `agent` | Agent Loop — 멀티턴 도구 실행, 단일 에이전트가 작업 완료까지 반복 |
| `task` | Task Loop — 단계형 장기 실행, 순차 노드(`TaskNode[]`)로 체크포인트 기반 진행 |
| `phase` | Phase Loop — 다중 에이전트 단계별 워크플로우, 페이즈 내 병렬 실행 + critic 검토 |

특정 모드가 체크 해제된 프로바이더는 해당 모드에서 사용되지 않습니다.

### Phase Loop 모드 상세

Phase Loop는 `phase` 모드에서 활성화됩니다. 오케스트레이터 분류기가 다음 조건에서 `phase`로 판별합니다:

- 사용자가 `/workflow` 커맨드로 명시적 요청
- 대시보드 Workflows 페이지에서 워크플로우 생성
- 다수 전문가가 병렬로 분석/작업 후 종합이 필요한 요청
  - 예: "시장 조사해줘", "이 프로젝트 전체 리뷰해줘", "경쟁사 분석 + 기술 분석 + 전략 수립"

Phase Loop 사용 시 워크플로우 정의에서 에이전트별로 다른 프로바이더를 지정할 수 있습니다:

```yaml
agents:
  - role: 시장조사관
    backend: openrouter      # OpenRouter 사용
    model: gpt-5.1-codex-max
  - role: 기술분석가
    backend: openai_compatible  # 로컬 vLLM 사용
    model: qwen-72b
```

### Gateway 라우팅

오케스트레이터 분류기가 메시지를 먼저 분류하여 적절한 실행 경로로 라우팅합니다:

| 분류 | 라우팅 | 이유 |
|------|--------|------|
| `task` / `agent` | PTY spawn (컨테이너) | 멀티턴 도구 사용, 파일 수정 → 격리 필요 |
| `once` | Native turn (SDK/API) | 단일 API 호출로 충분 |
| `inquiry` | Direct reply | DB 쿼리만으로 응답 가능 |
| `builtin` | Direct reply | 슬래시 커맨드 → 기존 핸들러 |
| `phase` | Phase Loop runner | 다중 에이전트 워크플로우 실행 |

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| `Test` 실패 | API 토큰 유효성 확인 |
| 서킷 브레이커 `open` 지속 | 토큰 갱신 후 Enable 토글 |
| 응답 없음 | 우선순위가 높은 인스턴스가 Enabled 상태인지 확인 |
| SDK 백엔드 실패 | `backend_fallback` 로그 확인 (`claude_sdk` → `claude_cli` 자동 전환) |
| 컨테이너 실행 실패 | Docker/Podman 데몬 상태 확인, 이미지 pull 여부 확인 |
| LLM 런타임 확인 | `npm run health:llm` 실행 |

## 관련 문서

→ [에이전트 시스템](../core-concepts/agents.md)
→ [대시보드 가이드](./dashboard.md)
