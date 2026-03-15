> 마지막 업데이트: 2026-03-15 18:20:12

## 감사 범위

- `[합의완료]` FE-2 + FE-3 — Chat/Session Surface + Workflow/Eval/Schema Surface

## 독립 검증 결과

- `web/src/pages/chat.tsx`, `web/src/hooks/use-ndjson-stream.ts`, `web/src/pages/workspace/sessions.tsx`, `web/src/layouts/root.tsx`, `web/src/pages/chat/chat-status-bar.tsx`, `web/src/pages/workflows/detail.tsx`, `web/src/pages/prompting/run-result.tsx`, `web/src/pages/workflows/node-inspector.tsx`, `web/src/pages/workflows/inspector-output.tsx`, `web/tests/pages/chat-status-bar.test.tsx`, `web/tests/layouts/root-sse-stale.test.tsx`, `web/tests/workspace/sessions-user-scope.test.tsx`, `web/tests/pages/workflows/detail-badges.test.tsx`, `web/tests/prompting/run-result-eval.test.tsx`, `web/tests/pages/workflows/inspector-schema-badge.test.tsx`에 대해 `npx eslint <file>`를 파일별 재실행했고 모두 통과했다.
- `cd web && npx vitest run tests/pages/chat-status-bar.test.tsx tests/layouts/root-sse-stale.test.tsx tests/workspace/sessions-user-scope.test.tsx tests/pages/workflows/detail-badges.test.tsx tests/prompting/run-result-eval.test.tsx tests/pages/workflows/inspector-schema-badge.test.tsx` 재실행 결과 `6 files / 40 tests passed`.
- `cd web && npx tsc --noEmit`를 재실행했고 통과했다.
- `SOLID`, `YAGNI`, `DRY`, `KISS`, `LoD` 관점의 추가 구조 회귀는 확인하지 못했다.

## 최종 판정

- `[합의완료]` FE-2 + FE-3 — Chat/Session Surface + Workflow/Eval/Schema Surface

## 반려 코드

- 없음

## 핵심 근거

- `web/src/pages/chat.tsx:L33`, `web/src/pages/chat.tsx:L49`, `web/src/pages/chat.tsx:L51`, `web/src/pages/chat.tsx:L377`에서 `init_def` lazy init과 `ndjson_routing` 연결이 실제 채팅 화면에 반영된다.
- `web/src/hooks/use-ndjson-stream.ts:L14`, `web/src/hooks/use-ndjson-stream.ts:L56`, `web/src/hooks/use-ndjson-stream.ts:L139`와 `web/tests/pages/chat-status-bar.test.tsx:L46`, `web/tests/layouts/root-sse-stale.test.tsx:L87`에서 routing/SSE stale 경로가 직접 검증됐다.
- `web/tests/workspace/sessions-user-scope.test.tsx:L1`, `web/tests/pages/workflows/detail-badges.test.tsx:L1`, `web/tests/prompting/run-result-eval.test.tsx:L1`, `web/tests/pages/workflows/inspector-schema-badge.test.tsx:L1`이 세션 스코프와 workflow/eval/schema 표면을 직접 잠근다.
- claim과 residual risk의 설명은 현재 코드 동작과 일치하고, bonus fix로 추가된 FE-2 UI 경로도 전용 테스트가 포함돼 있다.

## 완료 기준 재고정

- 코드, 파일별 lint, 관련 테스트, `tsc` 재실행이 모두 닫혀 추가 재고정 사항이 없다.

## 다음 작업

- `Frontend Surface Integration / Bundle FE3 / FE-4 + FE-5 — admin/security/monitoring와 repository/retrieval/artifact 표면을 운영/소비자 표면으로 연결`
