# 하이브리드 벡터 검색 설계

## 목적

`hybrid vector search`는 키워드 기반 검색만으로 놓치기 쉬운 표현 변형과 의미적 유사성을 보완하기 위한 검색 설계다.
이 구조의 목적은 모든 요청을 벡터 검색으로 밀어 넣는 것이 아니라, 빠른 lexical 검색을 기본으로 두고 필요한 경우에만 semantic 검색을 보강하는 것이다.

핵심 의도는 다음과 같다.

- 짧고 명확한 요청은 lexical 검색만으로 빠르게 처리한다
- 표현이 달라도 같은 의도인 경우 semantic 검색으로 회수율을 높인다
- 임베딩 비용은 쓰기 시점이 아니라 검색 시점에 지불한다
- 임베딩이 없거나 외부 embedding provider가 비활성화돼도 시스템은 계속 동작한다

## 기본 원칙

현재 프로젝트의 하이브리드 검색은 다음 원칙을 따른다.

- lexical 검색이 1차 후보 집합을 만든다
- semantic 검색은 lexical 결과가 부족할 때만 보강층으로 동작한다
- 인덱스 저장과 검색 경로는 분리한다
- embedding freshness는 문서 본문 자체가 아니라 `content_hash`를 기준으로 판단한다
- embedding provider가 없으면 lexical-only로 자연스럽게 degrade 된다

즉 이 구조는 “벡터 우선 검색”이 아니라 “lexical 우선 + semantic 보강”이다.

## 적용 범위

이 설계는 현재 다음 영역에 공통 개념으로 적용된다.

- 도구 선택용 검색
- 메모리 검색
- reference 계열 검색
- 이후 추가되는 novelty gate / session reuse dedupe 계층

세부 랭킹 정책은 각 저장소마다 다를 수 있지만, 상위 설계 개념은 동일하다.

## 핵심 구조

```text
Query
  -> normalize / tokenize
  -> lexical retrieval
  -> candidate sufficiency 판단
  -> semantic supplement (optional)
  -> merged ranked results
```

여기서 중요한 것은 semantic 경로가 항상 열리지 않는다는 점이다.
lexical 결과가 이미 충분하면 검색은 거기서 끝난다.

## Lexical 우선 구조

하이브리드 검색의 1차 검색기는 lexical 검색이다.

현재 구조에서는 다음 요소가 lexical 계층을 이룬다.

- FTS 기반 저장소
- in-memory lexical mirror
- category / tag 기반 fallback
- 한국어 키워드 확장과 request normalization

이 설계의 목적은 벡터 검색이 없더라도 핵심 동작이 유지되도록 하는 것이다.
따라서 semantic 검색은 fallback이 아니라 supplement이며, lexical 계층이 항상 기준점이 된다.

## Semantic 보강 구조

semantic 검색은 embedding이 준비된 항목에 대해서만 작동한다.

기본 흐름은 다음과 같다.

1. 검색 요청이 들어온다
2. lexical 결과가 충분한지 판단한다
3. 부족한 경우에만 embedding을 확인한다
4. stale 하거나 누락된 항목은 검색 시점에 lazy embedding 한다
5. vector similarity 결과로 남은 슬롯을 보강한다

이 구조는 비용과 지연시간을 줄이기 위한 것이다.
도구 등록이나 메모리 쓰기 때마다 외부 embedding API를 호출하지 않는다.

## Lazy Embedding과 Content Hash

이 설계에서 embedding freshness는 시간 기준이 아니라 `content_hash` 기준이다.

- 쓰기 시에는 본문과 함께 `content_hash`만 기록할 수 있다
- 검색 시점에 embedding이 없거나 hash가 바뀌면 재생성한다
- 동일 content는 중복 embedding 하지 않는다

이 원칙은 다음 두 문제를 줄인다.

- 쓰기 경로의 API 비용 증가
- 내용은 안 바뀌었는데 embedding만 불필요하게 다시 만드는 문제

## 병합 원칙

lexical과 semantic 결과를 단순 평균으로 섞지 않는다.

현재 설계에서 병합 원칙은 다음에 가깝다.

- lexical 결과를 기본 순서로 유지한다
- semantic 결과는 lexical에서 비어 있는 슬롯을 채운다
- 이미 선택된 항목은 중복 포함하지 않는다
- category / core fallback은 semantic 이후가 아니라 전체 선택 정책 안에서 같이 조정된다

즉 semantic 검색은 ranking authority 전체를 대체하지 않는다.

## Graceful Degradation

이 설계는 embedding provider가 항상 존재한다고 가정하지 않는다.

다음 경우에도 시스템은 정상 동작해야 한다.

- embedding provider 미설정
- sqlite-vec 비활성화
- embedding API 일시 실패
- embedding freshness 확인 중 일부 항목 누락

이때 검색은 lexical-only로 내려가고, semantic 보강만 생략한다.
상위 기능은 실패하지 않아야 한다.

## Tool Selection과의 관계

도구 선택은 현재 lexical-first 검색을 사용하며, semantic 검색은 요청에 따라 추가 보강으로 동작한다.

여기서 중요한 점은 다음과 같다.

- 도구 선택은 full retrieval 시스템이 아니라 bounded candidate selection 문제다
- 따라서 recall만이 아니라 token budget과 설명 가능성이 중요하다
- semantic 보강은 lexical 선택이 애매한 경우를 줄이는 데 쓰인다

도구 선택 전용 정책은 `tool-selection-fts5` 문서에서 따로 설명한다.
이 문서는 그 하위에서 공유되는 검색 철학을 설명한다.

## Memory Search와의 관계

메모리 검색은 tool selection보다 더 긴 본문을 다루므로 semantic 보강 이득이 더 크다.
다만 다음 원칙은 동일하다.

- lexical 검색이 기본
- embedding은 lazy
- `content_hash`로 freshness 관리
- semantic 결과는 보강 결과

향후 session novelty gate나 reuse evidence도 같은 tokenizer / normalization 정책을 재사용해야 한다.

## 경계

이 설계가 하지 않는 일도 명확하다.

- 질문 의도가 recall인지 new search인지 판단하지 않는다
- tool budget이나 search budget을 직접 결정하지 않는다
- freshness policy를 질문 유형별로 최종 결정하지 않는다
- 사용자-facing 답변을 생성하지 않는다

즉 `hybrid vector search`는 retrieval 계층이지, orchestration policy 계층이 아니다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 로컬 우선 오케스트레이터이며, 모든 검색 요청을 외부 모델이나 고비용 벡터 경로에 의존하지 않도록 설계한다.
이 문서는 그 원칙을 다음처럼 정리한다.

- 빠른 lexical 경로를 기준으로 둔다
- semantic 검색은 선택적으로 보강한다
- embedding freshness는 `content_hash`로 관리한다
- 검색 실패보다 graceful degradation을 우선한다

## 비목표

- 특정 provider나 embedding 모델 하나를 source of truth로 고정하는 것
- 모든 검색을 semantic-first로 바꾸는 것
- 현재 라운드의 migration 상태를 기록하는 것
- 도구 선택, 메모리 검색, novelty gate의 세부 작업 항목을 직접 관리하는 것

이 문서는 현재 채택된 검색 설계 개념을 설명한다.
구체적인 tokenizer 통합, retrieval 확장, rollout 순서는 `docs/*/design/improved/*`에서 관리한다.
