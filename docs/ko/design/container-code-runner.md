# Container Code Runner 설계

## 목적

`container code runner`는 code node가 JavaScript와 shell 외의 언어를 안전한 격리 환경에서 실행할 수 있게 하는 설계다.
이 구조의 목적은 다중 언어 코드 실행을 지원하면서도, 로컬 프로세스 실행과는 다른 자원 제약과 파일시스템 경계를 분명히 유지하는 것이다.

현재 이 설계는 다음 요구를 위해 채택됐다.

- workflow 안에서 Python, Go, Rust 같은 언어를 직접 실행한다
- 언어별 런타임을 로컬 개발 환경에 강하게 결합하지 않는다
- 코드 실행을 읽기 전용 workspace와 제한된 자원 안에 둔다
- code node 하나가 여러 실행 경로를 가질 수 있게 한다

## 현재 실행 모델

현재 code node는 세 가지 실행 경로를 가진다.

- JavaScript
  - 인프로세스 `vm` sandbox
- shell
  - 로컬 shell runtime
- container language
  - podman/docker 기반 container code runner

즉 container code runner는 별도 노드가 아니라 `code` node의 세 번째 실행 경로다.
이 덕분에 workflow 작성자는 같은 `code` node 타입을 유지하면서 언어와 격리 수준만 바꿀 수 있다.

## 런타임 매핑

container code runner는 언어 이름을 곧바로 실행 명령으로 쓰지 않는다.
현재 구조에서는 언어별 runtime mapping을 통해 다음을 함께 결정한다.

- 기본 이미지
- 임시 파일 확장자
- 컨테이너 내부 실행 명령

이 구조의 의미는 “언어 지원”을 프롬프트 문구가 아니라 코드 계약으로 관리한다는 점이다.

## 격리 경계

container code runner는 현재 다음 경계를 기본값으로 둔다.

- 읽기 전용 코드 마운트
- 읽기 전용 workspace 마운트
- 제한된 메모리와 CPU
- `tmpfs` 기반 임시 쓰기 공간
- 기본 `--network=none`

이 설계의 핵심은 컨테이너가 단순 편의 기능이 아니라 sandbox 정책의 일부라는 점이다.
네트워크 허용이나 container 유지 역시 code node 입력에서 명시적으로 opt-in 해야 한다.

## one-shot과 persistent

현재 구조는 두 실행 모드를 함께 가진다.

- one-shot
  - `run --rm` 기반의 일회성 실행
- persistent
  - 이름 있는 컨테이너를 유지한 뒤 `exec`로 재사용

one-shot은 격리와 단순성을 우선하는 기본 경로다.
persistent는 동일 언어/환경을 반복 호출하는 workflow에서 초기화 비용을 줄이기 위한 선택적 경로다.

즉 `keep_container`는 성능 최적화 옵션이지 기본 실행 계약이 아니다.

## 엔진 선택

현재 container code runner는 podman과 docker를 모두 수용하지만, 내부에서는 “사용 가능한 컨테이너 엔진”이라는 공통 계약으로 다룬다.
엔진 감지는 실행 전 한 번 수행되고 캐시될 수 있으며, code node는 그 결과를 소비하기만 한다.

이 구조는 특정 엔진 종속 문법을 workflow 정의로 노출하지 않기 위한 것이다.

## 현재 프로젝트에서의 의미

이 프로젝트는 로컬 실행기이면서도 다중 언어 workflow와 에이전트 자동화를 함께 지원한다.
container code runner는 그 사이에서 “도구를 많이 늘리지 않고도 안전한 언어 실행 경로를 추가하는 방식”으로 의미를 가진다.

현재 구조에서 이 설계가 의미하는 바는 다음과 같다.

- 다중 언어 실행은 `code` node로 통합한다
- 로컬 shell과 container sandbox를 분리한다
- 자원 제한과 네트워크 정책을 node 옵션으로 명시한다
- code execution 결과는 공통 output contract로 정규화한다

## 비목표

- 모든 code 실행을 컨테이너로 강제하는 것
- 장기 상태를 가진 개발 환경 전체를 제공하는 것
- 컨테이너 오케스트레이션 자체를 workflow code node가 담당하게 하는 것
- docker/podman 세부 명령을 workflow 정의의 source of truth로 만드는 것

이 문서는 현재 채택된 container code runner 설계 개념을 설명한다.
세부 rollout과 후속 작업은 `docs/*/design/improved/*`에서 관리한다.
