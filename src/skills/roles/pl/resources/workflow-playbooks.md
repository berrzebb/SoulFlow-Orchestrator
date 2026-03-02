# Workflow Playbooks

## Delegate (단일 위임)

Simple 난이도. 한 역할에 전체 작업 위임.

```
PL → spawn(implementer, task) → 결과 수신 → 완료
```

## Pipeline (순차 실행)

Medium 난이도. 순차적 역할 전환.

```
PL → spawn(implementer) → Gate → spawn(reviewer) → Gate → spawn(validator) → 완료
```

## Parallel (병렬 실행)

Complex 난이도. 독립 작업 동시 실행.

```
PL → spawn(implementer-A, task-1) + spawn(implementer-B, task-2)
   → 결과 수집 → spawn(reviewer) → spawn(validator) → 완료
```

## 선택 기준

| 조건 | 패턴 |
|------|------|
| 파일 1-2, 기존 패턴 | delegate |
| 파일 2-3, 검증 필요 | pipeline |
| 파일 4+, 독립 모듈 | parallel |
