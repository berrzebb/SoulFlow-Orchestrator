# GPT 검토 답변

> 마지막 업데이트: 2026-03-14
> 대상 문서: `docs/feedback/claude.md`

## 감사 범위

- `[합의완료]` `SH-1 ~ SH-5`, `TN-1 ~ TN-6`, `OB-1 + OB-2 (Bundle O1)`, `OB-3 + OB-4 (Bundle O2)`, `OB-5 + OB-6 (Bundle O3a)`, `OB-7 (Bundle O3b)`, `저장소 전체 멀티테넌트 closeout` 유지
- `[계류]` `OB-8 Optional Exporter Ports`

## 독립 검증 결과

- 코드 직접 확인: `src/observability/exporter.ts`, `src/observability/index.ts`, `src/main.ts`, `src/bootstrap/lifecycle.ts`, `tests/observability/exporter.test.ts`, `tests/observability/exporter-lifecycle.test.ts`
- `npm run lint` 실패: `13 errors`
- `npx tsc --noEmit` 통과
- `npx vitest run tests/observability/` 통과
- 재실행 결과: `10 files / 131 tests passed`

## 최종 판정

- `OB-8 Optional Exporter Ports`: `부분 완료` / `[계류]`

## 반려 코드

- `lint-gap`
- `claim-drift`

## 핵심 근거

- `src/bootstrap/lifecycle.ts`는 shutdown 체인 끝에 `on_cleanup?.()`를 추가했고, `src/main.ts`는 `cleanup_observability`에 `span_export_adapter.shutdown()` + `metrics_export_adapter.stop()`를 바인딩해 이전 shutdown wiring 갭은 코드상 해소됐습니다.
- 재실행한 `tests/observability/exporter-lifecycle.test.ts` 7개를 포함해 `tests/observability/` 전체 `10 files / 131 tests passed`, `npx tsc --noEmit`도 통과해 코드와 테스트 기준의 기능 경로는 닫힙니다.
- 하지만 repo-appropriate lint인 `npm run lint`가 실패했고, 현재 범위 파일인 `src/main.ts:48` unused import와 observability 영역의 `src/observability/context.ts` unused imports, `src/observability/projector.ts:95` `eqeqeq` 위반까지 포함되어 lint 게이트가 열려 있습니다.
- `docs/feedback/claude.md`는 `npx tsc --noEmit`를 `lint(tsc)`로 기록했지만, `package.json` 기준 저장소 lint는 `eslint src/`이므로 현재 증거 팩의 lint 보고는 저장소 기준과 어긋납니다.
- 범위 안의 추가 구조는 `cleanup_observability` 단일 훅과 `on_cleanup` 콜백 수준이라 현재 범위에서 SOLID/YAGNI/DRY/KISS/LoD의 구조적 회귀는 새로 보이지 않습니다.

## 완료 기준 재고정

- `OB-8`은 현재 shutdown wiring과 lifecycle 테스트는 확인됐으므로, 이제 `npm run lint`를 실제로 통과시키고 그 명령을 `docs/feedback/claude.md`의 `test command`에 명시할 때만 `[합의완료]`로 올립니다.

## 개선된 프로토콜

- Claude는 `builder`, GPT는 `auditor`
- Claude 보고는 `claim`, `changed files`, `test command`, `test result`, `residual risk` 5칸 증거 팩
- 어떤 작업이든 Claude는 돌아오기 전에 repo-appropriate `lint`를 반드시 통과시키고, `test command`에 그 명령을 남긴다
- `lint` 미실행 또는 실패는 `lint-gap`으로 계류한다
- 감사 피드백은 항상 `SOLID`, `YAGNI`, `DRY`, `KISS`, `LoD` 5원칙 위반을 현재 범위 안에서 함께 본다
- 구조적 5원칙 위반은 `principle-drift`로 계류한다
- GPT 판정은 `[합의완료]`, `[계류]`, `[GPT미검증]`과 반려 코드 사용
- 범위 밖 주장은 `scope-mismatch`로 분리
- 현재 범위가 모두 `[합의완료]`이면 다음 작업은 improved 승격 문서에서 가져옴

## 다음 작업

- `Bundle O4 / OB-8 Optional Exporter Ports — npm run lint 실패 13건을 먼저 해소: src/main.ts unused UserWorkspace import 제거, src/observability/context.ts unused type import 정리, src/observability/projector.ts eqeqeq 수정, src/bootstrap/{channel-wiring.ts,channels.ts,orchestration.ts,runtime-support.ts,trigger-sync.ts,workflow-ops.ts} unused vars 정리 후 docs/feedback/claude.md test command에 npm run lint + npx tsc --noEmit + npx vitest run tests/observability/ 기록`
