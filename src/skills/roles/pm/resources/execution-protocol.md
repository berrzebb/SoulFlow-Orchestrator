# PM Execution Protocol

## 1. 요구사항 수집

- 사용자/집사 요청 분석
- 불확실성 분류 (clarification-protocol)
- HIGH 불확실성 → 즉시 질문

## 2. 코드베이스 탐색

- 관련 파일/모듈 파악
- 기존 패턴/컨벤션 확인
- 의존성 매핑

## 3. 스펙 작성

- spec-template.md 기반
- 파일 목록 + 변경 범위
- 리스크/제약 조건

## 4. 난이도 분류

- difficulty-guide 적용
- 턴 예산 배정

## 5. PL 전달

- `spawn(role: "pl", task: "스펙 기반 실행...")`
- 스펙 내용을 task에 포함

## 금지 사항

- 직접 코드 작성/수정
- Phase Gate 미충족 상태에서 PL 전달
