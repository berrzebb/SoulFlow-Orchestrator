# 메모리 검색 설계

## 목적

`memory search`는 대화 중 생성된 기록과 장기 메모리를 다시 찾아 쓸 수 있게 만드는 검색 계층이다.
이 설계의 목적은 단순히 메모리를 저장하는 것이 아니라, **짧은 daily 기록과 긴 longterm 문서를 같은 시스템에서 검색 가능하게 유지하면서도 최근성과 의미 유사성을 함께 반영하는 것**이다.

핵심 의도는 다음과 같다.

- 문서 단위가 아니라 검색 가능한 chunk 단위로 메모리를 다룬다
- lexical 검색과 semantic 검색을 함께 사용하되 lexical을 기준으로 둔다
- 최근 기록은 더 잘 보이게 하고, 오래된 기록은 자연스럽게 감쇠한다
- 대화가 압축되기 전에 durable memory를 남길 수 있도록 flush 지점을 제공한다

## 메모리 모델

현재 메모리 계층은 크게 두 종류를 다룬다.

- `daily`
  - 날짜 단위의 일지형 기록
- `longterm`
  - 장기적으로 유지해야 하는 구조화/서술형 기억

상위 설계에서 중요한 점은 둘이 같은 검색 시스템 안에서 검색되지만, 같은 의미로 관리되지는 않는다는 점이다.

- `daily`는 recency가 중요하다
- `longterm`은 상대적으로 evergreen 성격을 가진다

## 저장과 검색의 분리

메모리의 source of truth는 문서 단위 저장소다.
검색은 그 위의 파생 인덱스를 사용한다.

```text
memory document
  -> chunking
  -> lexical index
  -> optional vector index
  -> ranked retrieval
```

이 구조의 의도는 다음과 같다.

- 저장 포맷을 검색 포맷에 종속시키지 않는다
- chunk 인덱스는 재생성 가능해야 한다
- embedding이 없더라도 lexical 검색은 계속 가능해야 한다

## Chunk 기반 검색

메모리 검색은 전체 문서가 아니라 chunk를 검색 단위로 사용한다.

chunking의 목적은 다음과 같다.

- 긴 문서의 여러 주제를 하나의 embedding으로 평균화하지 않는다
- 검색 결과가 “문서 전체”가 아니라 “관련 구간”을 가리키게 한다
- line / file / snippet 형태로 근거를 사용자나 실행기에 돌려줄 수 있게 한다

chunk는 일반적으로 다음 정보를 가진다.

- 원본 문서 키
- heading
- line range
- chunk content
- content hash
- 생성 시각 또는 원문 시각

즉 메모리 검색의 실제 retrieval 단위는 `memory document`가 아니라 `memory chunk`다.

## 하이브리드 검색

메모리 검색은 lexical 검색과 semantic 검색을 같이 사용한다.

기본 원칙은 다음과 같다.

- lexical 검색이 기본 candidate set을 만든다
- semantic 검색은 embedding이 있을 때 보강층으로 동작한다
- embedding provider가 없으면 lexical-only로 degrade 된다
- chunk freshness는 `content_hash` 기준으로 확인한다

이 설계는 메모리 검색을 `hybrid-vector-search` 철학 위에 올린 특화 사례다.

## 점수 병합

메모리 검색은 단순 합집합이 아니라 rank 기반 병합을 사용한다.

상위 설계 개념은 다음과 같다.

- lexical 결과와 semantic 결과를 각각 순위 목록으로 취급한다
- 두 목록은 reciprocal-rank 스타일의 병합으로 합쳐진다
- 점수 스케일 정규화보다 순위 안정성을 우선한다

이 접근은 BM25 점수와 vector distance를 억지로 같은 스케일로 맞추는 문제를 피하기 위한 것이다.

## 시간 감쇠

메모리 검색은 모든 기록을 동일 가중치로 보지 않는다.

특히 `daily` 계열은 시간 감쇠를 적용할 수 있어야 한다.

그 이유는 다음과 같다.

- 어제의 작업 문맥과 세 달 전의 일지는 같은 중요도가 아니다
- 최근 맥락을 더 잘 회수해야 세션 연속성이 좋아진다
- 오래된 기록은 사라지지 않더라도 상위 랭크를 덜 차지해야 한다

반대로 `longterm`은 모든 경우에 강한 감쇠를 주는 대상이 아니다.
상위 설계 관점에서 `daily`와 `longterm`은 recency 정책이 다를 수 있어야 한다.

## Compaction Flush와의 관계

메모리 검색 설계는 저장소 설계만이 아니라, 대화 compaction과도 연결된다.

컨텍스트가 압축되기 전에 다음이 가능해야 한다.

- 중요한 대화 내용을 durable memory로 저장
- 이후 검색 경로에서 다시 찾을 수 있도록 chunk 인덱스에 반영

즉 memory search는 저장 이후 retrieval만 담당하는 것이 아니라, **기억 보존과 재발견이 이어지는 폐쇄 루프**의 검색 측면이다.

## 검색 결과 형태

메모리 검색 결과는 단순 텍스트 리스트보다, “어디에서 나온 어떤 근거인지”를 포함하는 구조를 지향한다.

예를 들면:

- source file or logical path
- line number or line range
- snippet text
- optional score metadata

이 구조는 이후 novelty gate, session reuse, answer synthesis, audit에서도 재사용할 수 있다.

## 경계

이 설계가 하지 않는 일도 명확하다.

- 어떤 기억을 저장할지 최종 결정하지 않는다
- 세션 요약 정책 전체를 정의하지 않는다
- 사용자-facing 답변 문장을 생성하지 않는다
- novelty gate의 reuse / retry 결정을 직접 내리지 않는다

즉 `memory search`는 저장소 위의 retrieval 설계이지, conversation policy 전체가 아니다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 메모리를 단순 텍스트 append 저장소가 아니라, 검색 가능한 작업 기억 계층으로 사용한다.
이 문서는 그 상위 설계를 다음처럼 고정한다.

- 문서는 source of truth다
- 검색은 chunk 단위다
- 검색은 hybrid다
- recency는 ranking에 반영된다
- compaction 직전 durable memory flush와 연결된다

## 비목표

- 특정 embedding provider 하나를 강제하는 것
- 모든 메모리 저장을 자동화 규칙 하나로 고정하는 것
- 현재 구현 상태나 테스트 통과 여부를 기록하는 것
- 세부 scoring 파라미터와 rollout 순서를 이 문서에서 관리하는 것

이 문서는 현재 채택된 메모리 검색 설계 개념을 설명한다.
세부 breakdown과 후속 작업은 `docs/*/design/improved/*`에서 관리한다.
