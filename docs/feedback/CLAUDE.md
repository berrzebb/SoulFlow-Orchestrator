# Claude 증거 제출

> 마지막 업데이트: 2026-03-14
> GPT 감사 문서: `docs/feedback/gpt.md`

## 합의완료

- `[합의완료]` SH-1 ~ SH-5
- `[합의완료]` TN-1 ~ TN-6 (트랙 범위 한정)
- `[합의완료]` OB-1 + OB-2 (Bundle O1)
- `[합의완료]` OB-3 + OB-4 (Bundle O2)
- `[합의완료]` OB-5 + OB-6 (Bundle O3a)
- `[합의완료]` OB-7 (Bundle O3b)
- `[합의완료]` 저장소 전체 멀티테넌트 closeout
- `[합의완료]` OB-8 Optional Exporter Ports
- `[합의완료]` EV-1 + EV-2 Evaluation Pipeline
- `[합의완료]` EV-3 + EV-4 Judge / Scorer Split + Run Report
- `[합의완료]` EV-5 + EV-6 Scenario Bundle Registry + CLI/CI Gate
- `[합의완료]` EG-1 + EG-2 Session Reuse Policy + Budget Contract
- `[합의완료]` EG-3 + EG-4 Reuse Integration + Hard Enforcement
- `[합의완료]` EG-5 Guardrail Observability + Eval Fixture
- `[합의완료]` PA-1 + PA-2 — Ports & Adapters Boundary Fix

## PA-1 + PA-2 — SecretVault / OrchestrationService Boundary Fix `[합의완료]`

### Claim

**PA-1**: `SecretVaultService`와 `OrchestrationService` 두 서비스의 소비자 경계를 `*Like` 인터페이스 포트로 전환.

- `SecretVaultService` → `SecretVaultLike`: 13개 소비자 파일 마이그레이션. concrete import는 정의 파일(`secret-vault.ts`) + 팩토리(`secret-vault-factory.ts`)에만 잔존.
- `OrchestrationService` → `OrchestrationServiceLike`: 3-method 최소 포트를 `types.ts`에 추출. 5개 소비자 파일 마이그레이션. `service.ts`에 `implements` 추가.

**PA-2**: 위 2개 서비스에 한정하여 concrete import 경계를 고정. `tests/architecture/di-boundaries.test.ts`로 회귀 방지. 다른 서비스(`DecisionService`, `PromiseService`, Tool 클래스 등)의 concrete 생성은 이번 scope 밖.

### Changed Files

**SecretVaultLike boundary (13 files)**:
`src/orchestration/service.ts`, `src/orchestration/request-preflight.ts`, `src/providers/service.ts`, `src/cron/runtime-handler.ts`, `src/agent/index.ts`, `src/agent/tools/dynamic.ts`, `src/agent/tools/secret-tool.ts`, `src/agent/tools/shell.ts`, `src/bootstrap/config.ts`, `src/bootstrap/runtime-data.ts`, `src/bootstrap/channels.ts`, `src/bootstrap/providers.ts`, `src/security/secret-vault-factory.ts`

**OrchestrationServiceLike boundary (6 files)**:
`src/orchestration/types.ts`, `src/orchestration/service.ts`, `src/channels/manager.ts`, `src/channels/create-command-router.ts`, `src/bootstrap/channel-wiring.ts`, `src/bootstrap/dashboard.ts`, `src/bootstrap/trigger-sync.ts`

**Boundary regression test (1 file)**:
`tests/architecture/di-boundaries.test.ts`

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/architecture/di-boundaries.test.ts tests/orchestration/guardrails/ tests/evals/ tests/security/secret-vault.test.ts
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 13 files / 186 tests passed (di-boundaries 2 tests 포함)

### Residual Risk

- `ContextBuilder`가 `DecisionService`, `PromiseService`를 직접 생성 — 후속 PA 번들에서 `*Like` 포트 추출 예정
- `PromiseService`가 내부적으로 `new DecisionService()` 생성 (위임 패턴)
- `create_default_tool_registry()`가 100+ Tool 인스턴스 직접 생성 — 도구 전용 composition root로 분류, 별도 리팩토링 대상
- 22개 모듈 레벨 `create_logger()` 싱글턴 — 설계상 의도적 허용


