# sqlite-vec 벡터 스토어 설계

## 목적

`vector store`는 벡터 기반 유사도 검색이 필요한 저장소에 공통으로 사용할 수 있는 SQL 레벨 검색 기반을 제공한다.
이 설계의 목적은 JavaScript에서 전체 벡터를 읽어 brute-force 계산하는 것이 아니라, **SQLite 내부에서 native KNN 검색을 수행하는 로컬 우선 벡터 저장소**를 제공하는 것이다.

핵심 의도는 다음과 같다.

- 벡터 검색을 로컬 데이터베이스 안에서 처리한다
- 컬렉션별 메타데이터와 벡터 저장을 분리한다
- 정규화된 벡터와 거리 계산 규칙을 공통으로 고정한다
- retrieval 계층이 필요로 하는 최소 공통 연산만 제공한다

## 위치

이 벡터 스토어는 retrieval과 orchestration 상위 정책 아래에서 공통 인프라로 동작한다.

```text
retrieval or search service
  -> vector-store service
  -> SQLite + sqlite-vec
```

즉 이 계층은 독립적인 product feature가 아니라, memory / reference / eval / retrieval 경로가 공유할 수 있는 저장 엔진이다.

## 기본 구조

벡터 스토어는 한 컬렉션을 두 층으로 나눈다.

- metadata table
  - id, document, metadata 같은 일반 필드
- vec table
  - 실제 embedding 벡터

이 분리의 목적은 다음과 같다.

- 사람이 읽는 문서/메타데이터와 벡터 저장 표현을 섞지 않는다
- metadata 조회와 KNN 조회를 명시적으로 연결한다
- collection 단위 초기화와 삭제를 단순화한다

## 벡터 정규화

현재 설계는 정규화된 벡터를 기준으로 한다.

핵심 규칙:

- 저장 전에 벡터를 L2 normalize 한다
- 검색도 normalize된 query vector로 수행한다
- distance는 sqlite-vec가 제공하는 KNN distance를 사용한다
- similarity 해석은 정규화된 벡터의 거리 기준으로 맞춘다

이 접근의 목적은 코사인 기반 의미 유사도와 L2 기반 native 검색을 안정적으로 연결하는 것이다.

## 연산 모델

벡터 스토어는 최소 공통 연산을 제공한다.

- `upsert`
- `query`
- `delete`

상위 설계 관점에서 중요한 점은 이 연산들이 “문서 저장소”의 풍부한 CRUD를 제공하는 것이 아니라, **retrieval에 필요한 bounded contract**를 제공한다는 점이다.

즉 vector store는 범용 문서 DB가 아니라 similarity index service다.

## 컬렉션 모델

벡터 스토어는 `store_id`와 `collection` 조합으로 데이터를 분리할 수 있어야 한다.

이 구조의 의미는 다음과 같다.

- 서로 다른 기능이 같은 DB 파일을 강제로 공유하지 않아도 된다
- 하나의 store 안에서도 collection별 차원을 구분할 수 있다
- retrieval subsystem이 독립적으로 lifecycle을 가질 수 있다

컬렉션은 보통 차원 수가 고정된 vec table과 대응된다.
따라서 차원 수는 collection identity의 일부처럼 취급된다.

## sqlite-vec와의 관계

이 설계는 sqlite-vec를 벡터 검색 구현체로 사용하지만, 상위 설계 의도는 특정 확장 함수 하나에만 묶이지 않는다.

상위 개념은 다음과 같다.

- 로컬 SQLite 기반 저장
- native KNN
- metadata + vector 분리
- graceful failure 시 빈 결과 또는 검색 실패 격리

즉 sqlite-vec는 현재 채택 구현체이고, 설계 개념은 “local native vector index”다.

## 오류와 Graceful Degradation

벡터 스토어는 retrieval path의 일부이므로, 실패가 전체 시스템을 무너뜨리면 안 된다.

다음 경우를 격리할 수 있어야 한다.

- sqlite-vec 로드 실패
- 컬렉션 미초기화
- 잘못된 차원 입력
- 개별 query 실패

이때 상위 retrieval 계층은 lexical-only fallback 또는 빈 결과 처리로 이어질 수 있어야 한다.

즉 vector store는 강한 성능 계층이지만, product availability를 깨는 hard dependency가 되어선 안 된다.

## retrieval 계층과의 관계

벡터 스토어 자체는 ranking policy를 정의하지 않는다.

그 위에서 결정되는 것은 다음이다.

- lexical 후보를 먼저 만들지
- semantic-only path를 열지
- 어떤 fusion 정책을 쓸지
- freshness를 어떻게 관리할지

vector store는 그중 “semantic nearest-neighbor lookup”만 책임진다.

## 경계

이 설계가 하지 않는 일은 다음과 같다.

- embedding 생성 자체를 담당하지 않는다
- tokenizer, lexical retrieval, RRF를 정의하지 않는다
- query intent나 novelty를 판단하지 않는다
- 사용자-facing 응답을 구성하지 않는다

즉 `vector-store-sqlite-vec`은 retrieval 엔진의 하부 저장소 설계다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 로컬 우선 오케스트레이터이므로, 벡터 검색도 외부 서비스가 아닌 로컬 저장소 위에서 수행하는 것이 중요하다.
이 문서는 그 상위 설계를 다음처럼 정리한다.

- SQLite를 기본 저장소로 사용한다
- sqlite-vec로 native KNN을 수행한다
- metadata와 vector를 분리한다
- similarity는 정규화된 벡터 규칙으로 해석한다
- 실패는 상위 검색 경로에서 격리 가능해야 한다

## 비목표

- 모든 검색 문제를 vector store 하나로 해결하는 것
- retrieval 정책 전체를 이 문서에 넣는 것
- 현재 구현 완료 상태를 기록하는 것
- embedding provider 선택과 rollout 순서를 여기서 관리하는 것

이 문서는 현재 채택된 벡터 저장소 설계 개념을 설명한다.
세부 확장 계획과 작업 분류는 `docs/*/design/improved/*`에서 관리한다.
