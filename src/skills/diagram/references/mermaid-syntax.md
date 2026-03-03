# Mermaid 다이어그램 문법 레퍼런스

## Flowchart

```mermaid
graph TD
  A[시작] --> B{조건}
  B -->|Yes| C[처리]
  B -->|No| D[종료]
  C --> D
```

방향: `TD` (위→아래), `LR` (왼→오른), `BT`, `RL`
노드: `[]` 사각형, `()` 둥근 사각형, `{}` 마름모, `(())` 원

## Sequence

```mermaid
sequenceDiagram
  participant A as 클라이언트
  participant B as 서버
  A->>B: 요청
  B-->>A: 응답
  A->>B: 확인
```

화살표: `->>` 실선, `-->>` 점선, `-x` 비동기

## ERD

```mermaid
erDiagram
  USER ||--o{ ORDER : places
  ORDER ||--|{ ITEM : contains
  USER {
    int id PK
    string name
    string email
  }
```

관계: `||--||` 1:1, `||--o{` 1:다, `}o--o{` 다:다

## Class

```mermaid
classDiagram
  class Animal {
    +String name
    +eat() void
  }
  class Dog {
    +bark() void
  }
  Animal <|-- Dog
```

## State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*] : complete
```

## Gantt

```mermaid
gantt
  title 프로젝트 계획
  dateFormat YYYY-MM-DD
  section Phase 1
    설계 :a1, 2024-01-01, 7d
    개발 :after a1, 14d
```

## Pie

```mermaid
pie title 비율
  "A" : 40
  "B" : 35
  "C" : 25
```

## Mindmap

```mermaid
mindmap
  root((중심))
    주제1
      세부1
      세부2
    주제2
      세부3
```

## 공통 팁

- 노드 ID는 알파벳+숫자만 (한글 ID 금지, 한글은 `[]` 라벨에)
- 긴 라벨은 `<br/>` 줄바꿈 사용
- 특수문자는 `""`로 감싸기
