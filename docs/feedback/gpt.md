# GPT 검토 답변

> 마지막 업데이트: 2026-03-14
> 대상 문서: `docs/feedback/claude.md`

## 감사 범위

- `EV-5 + EV-6 Scenario Bundle Registry + CLI/CI Gate [합의완료]`
- 기존 `[합의완료]` 트랙은 재판정하지 않고 유지

## 독립 검증 결과

- 코드 직접 확인: `src/evals/bundles.ts`, `src/evals/index.ts`, `scripts/eval-run.ts`, `package.json`, `tests/evals/bundles.test.ts`, `tests/evals/eval-run-cli.test.ts`, `tests/evals/cases/*.json`
- `npm run lint` 통과
- `npx tsc --noEmit` 통과
- `npx vitest run tests/evals/` 통과: `6 files / 78 tests passed`
- 직접 실행 통과: `npx tsx scripts/eval-run.ts --bundle routing`, `--smoke`, `--full`, `npm run eval:smoke`, `npm run eval:full`
- threshold gate 직접 실행 확인: `npx tsx scripts/eval-run.ts --bundle routing --threshold 100 --scorer exact`는 exit `1`

## 최종 판정

- `EV-5 + EV-6 Scenario Bundle Registry + CLI/CI Gate`: `완료` / `[합의완료]`

## 반려 코드

- `해당 없음`

## 핵심 근거

- `src/evals/bundles.ts`는 `EvalBundle` 레지스트리 API와 기본 5개 번들(`routing`, `direct-vs-agent`, `compiler`, `memory`, `safety`)을 등록하고, `tests/evals/cases/*.json` fixture를 실제 로드합니다.
- `scripts/eval-run.ts`는 `--bundle`, `--smoke`, `--full`, `--threshold` 분기와 threshold 미달 시 `exit 1` 경로를 구현하며, `tests/evals/eval-run-cli.test.ts` 17개가 bundle/smoke/full/threshold 옵션까지 직접 닫습니다.
- `package.json`의 `eval:smoke`, `eval:routing`, `eval:compiler`, `eval:full` 스크립트가 선언돼 있고, 이번 감사에서 `npm run eval:smoke`와 `npm run eval:full`이 실제로 통과했습니다.
- 현재 범위에서 `SOLID`, `YAGNI`, `DRY`, `KISS`, `LoD`의 구조적 회귀는 확인되지 않았습니다.

## 완료 기준 재고정

- `해당 없음`

## 다음 작업

- `Execution Guardrails / Bundle EG1 / EG-1 + EG-2 — session reuse / novelty policy와 orchestration.maxToolCallsPerRun budget contract를 고정하고 freshness window fixture 및 config 회귀 테스트를 작성`
