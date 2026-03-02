# PL Execution Protocol

## 1. 스펙 수신

- PM 스펙 파싱
- 난이도 확인 (difficulty-guide)
- 역할 매핑: 어떤 팀원이 필요한지 결정

## 2. 팀 구성

- Simple: 단일 implementer
- Medium: implementer + reviewer
- Complex: implementer + reviewer + validator (병렬/순차 판단)

## 3. 실행 감독

- 각 서브에이전트 결과 수신
- Phase Gate 체크 (phase-gates)
- 차단 시 error-escalation 적용

## 4. 결과 검증

- 최종 산출물이 스펙을 충족하는지 확인
- 미충족 시 재작업 지시 또는 사용자 보고

## 금지 사항

- 직접 코드 작성 (implementer에 위임)
- Gate 미충족 상태에서 다음 단계 진행
