# Language Reference: Rust

## 빌드

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| 타입 검사 | `cargo check` | 에러 0건 |
| 릴리스 빌드 | `cargo build --release` | exit 0 |

## 테스트

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| 단위/통합 | `cargo test` | 전체 통과 |
| 특정 크레이트 | `cargo test -p <crate>` | 전체 통과 |

## 린트

| 단계 | 명령어 | 성공 기준 |
|------|--------|----------|
| Clippy | `cargo clippy -- -D warnings` | 워닝 0건 |
| 포맷 | `cargo fmt --check` | 차이 0건 |

## 에러 유형별 대응

| 유형 | 증상 | 대응 |
|------|------|------|
| 소유권 에러 | `borrow of moved value` | Clone, 참조, 수명 재설계 |
| 수명 에러 | `lifetime may not live long enough` | 명시적 수명 파라미터 또는 구조 변경 |
| 트레이트 미구현 | `the trait ... is not implemented` | derive 추가 또는 수동 impl |
| 순환 의존성 | 크레이트 간 순환 | 공통 타입 크레이트 분리 |

## 코드 컨벤션

- `unwrap()`/`expect()` 금지 (테스트 제외) → `?`, `ok_or()`, `unwrap_or()`
- 금융 계산 → `rust_decimal::Decimal` (f64 금지)
- 시간 → `DateTime<Utc>` (Local 금지)
- `#[allow(clippy::...)]` 우회 금지 → 코드 직접 수정
- NewType 패턴: `OrderId(String)`, `StrategyId(String)`
