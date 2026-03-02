# Implementer Execution Protocol

## 1. 스펙 확인

- 변경 대상 파일 목록 확인
- 요구사항 파악
- 불확실성 분류 (clarification-protocol)

## 2. 코드 탐색

- 기존 코드 패턴/컨벤션 파악
- 관련 모듈 의존성 확인

## 3. 구현

- 스펙 기준 파일 수정
- 기존 패턴 준수
- 최소 변경 원칙
- 언어별 컨벤션 적용 (`_shared/lang/` 참조)

## 4. 셀프 검증

- 빌드 확인 (언어별 빌드 명령 → `_shared/lang/` 참조)
- 기본 동작 테스트
- 변경 범위가 스펙과 일치하는지 확인

## 5. 보고

- 변경 파일 목록
- 셀프 검증 결과
- 미해결 이슈 (있으면)

## 에러 처리

- error-escalation 규칙 적용
- [에러 복구 시나리오](error-playbook.md) 참조
