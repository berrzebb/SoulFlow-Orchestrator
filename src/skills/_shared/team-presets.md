# 팀 프리셋 정의

## 팀 구성 프리셋

| 팀 | 역할 구성 | 책임 |
|---|----------|------|
| **기획팀** | PM | 계획 수립, 계획 검토, 문서 작성 |
| **품질관리팀** | Reviewer + (Implementer) | 코드 검토, 오류 수정, 구조 개선 |
| **테스트팀** | Validator | 기능 테스트, 오류 진단, 화면 확인 |

## 풀 팀 체인

```
PM → PL → Implementer → Reviewer → Validator
```

## 라이트 팀 체인

```
PM → Implementer → Validator
```

## 역할 정의

### PM (Project Manager / 설계자)
- 칸반 보드 생성 및 계획서 작성
- 목표, 범위, 완료 기준 정의
- 역할 배정 및 우선순위 결정

### PL (Project Lead / 분배자)
- 전체 작업을 카드로 분해하여 todo 등록
- WIP 제한 내에서 in_progress 이동
- 의존성/복잡도 기반 순서 결정

### Implementer (구현자)
- 실제 코드 작성/수정
- 완료 시 in_review로 이동
- 오류 반환 시 피드백 기반 재작업

### Reviewer (리뷰어)
- 코드 품질, 구조, 보안 검토
- 체크리스트 기반 통과/반환 결정
- 구체적 피드백과 함께 반환

### Validator (검증자)
- 빌드/테스트/lint 자동 실행
- 오류 적음: 즉시 수정 후 done
- 오류 많음: Implementer 반환
