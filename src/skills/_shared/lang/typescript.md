# Language Reference: TypeScript

## 빌드

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| 타입 검사 | `npx tsc --noEmit` | 에러 0건 |
| 번들 빌드 | `npm run build` | exit 0 |

## 테스트

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| 단위/통합 | `npx vitest run` | 전체 통과 |
| E2E | `npx vitest run --config vitest.e2e.config.ts` | 전체 통과 |

## 린트

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| ESLint | `npx eslint .` | 에러 0건 |

## 에러 유형별 대응

| 유형 | 증상 | 대응 |
|------|------|------|
| 타입 에러 | `TS2322`, `TS2345` 등 | 타입 선언 수정 또는 누락 필드 추가 |
| import 에러 | `Cannot find module` | 경로/확장자 확인, `.js` suffix |
| 제네릭 에러 | 복잡한 추론 실패 | 명시적 타입 파라미터 지정 |
| 순환 의존성 | `ReferenceError` 런타임 | 모듈 분리 또는 지연 import |

## 코드 컨벤션

- `any` 금지 → `unknown` 또는 구체적 타입
- `@ts-ignore`, `eslint-disable` 금지 → 코드 직접 수정
- 미사용 import 금지 (`_` 접두사 허용)
- 리터럴 유니온 타입 우선: `type Side = "buy" | "sell"`
