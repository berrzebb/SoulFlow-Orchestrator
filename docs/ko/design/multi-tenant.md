# 멀티테넌트 설계

## 목적

`multi-tenant` 설계는 한 프로세스 안에서 여러 팀과 사용자를 안전하게 분리하면서도, 공유 가능한 리소스는 팀 문맥 안에서 함께 쓸 수 있게 만드는 구조다.
이 프로젝트에서 멀티테넌트의 핵심 목적은 “여러 사용자를 지원한다”가 아니라, **팀 문맥과 개인 작업 공간을 동시에 유지하는 런타임 구조**를 만드는 것이다.

핵심 의도는 다음과 같다.

- 인증은 사용자 단위로 수행하되, 정책과 공유 자산은 팀 단위로 적용한다
- 개인 runtime 데이터는 계속 사용자별 workspace에 격리한다
- 팀 공통 자산은 팀 문맥에서 재사용한다
- 요청, 세션, 채널, SSE, 저장소 접근이 같은 tenant 문맥을 보도록 맞춘다

## 테넌트 모델

현재 프로젝트는 다음 모델을 채택한다.

- `tenant = team`
- `user = team membership을 가진 사용자`
- `workspace = 팀 안에서의 개인 작업 공간`
- `resource scope = global | team | personal`

이 모델은 전역 관리자, 팀 관리자, 일반 사용자의 경계를 동시에 설명할 수 있어야 한다.

## 디렉토리 모델

멀티테넌트 구조는 workspace-root 기반 bootstrap 전제를 유지하면서 팀과 사용자를 계층화한다.

```text
$WORKSPACE/
├── admin/
│   ├── admin.db
│   └── security/
└── tenants/
    ├── <team_id>/
    │   ├── team.db
    │   ├── runtime/
    │   ├── shared/
    │   └── users/
    │       └── <user_id>/
    │           ├── runtime/
    │           ├── workflows/
    │           ├── templates/
    │           ├── skills/
    │           └── references/
    └── <another_team_id>/
```

이 구조의 의미는 다음과 같다.

- `admin/`
  - 시스템 전역 계정, 전역 설정, 전역 provider
- `tenants/<team_id>/team.db`
  - 팀 메타데이터, membership, 팀 정책, 팀 공유 리소스 메타데이터
- `tenants/<team_id>/runtime`
  - 팀 공통 실행 자산
- `tenants/<team_id>/users/<user_id>`
  - 사용자별 개인 작업 공간

중요한 점은 bootstrap이 여전히 “workspace path를 받는 runtime”이라는 점이다.
즉 멀티테넌트는 bootstrap 구조를 버리지 않고, 그 경로를 팀/사용자 계층으로 확장한다.

## 인증과 요청 문맥

멀티테넌트 구조에서 인증은 사용자 기반이지만, 요청 문맥은 팀과 사용자 둘 다 포함해야 한다.

요청 문맥은 최소한 다음 정보를 가져야 한다.

- `user_id`
- `team_id`
- `workspace_path`
- `runtime path layers`

이 정보는 다음 계층에서 공통으로 쓰인다.

- route context
- workspace resolution
- provider / definition scope filter
- session key
- channel ownership
- SSE broadcast scope

즉 멀티테넌트는 단순히 JWT에 `tid`를 넣는 문제가 아니라, **요청 전체가 같은 tenant identity를 공유하도록 만드는 것**이다.

## Workspace Runtime 모델

멀티테넌트 구조에서 runtime identity는 단일 workspace path보다 풍부해야 한다.

핵심 개념은 다음과 같다.

```ts
type WorkspaceKey = {
  team_id: string;
  user_id: string;
  workspace_path: string;
};

type WorkspaceRuntime = {
  team_id: string;
  user_id: string;
  workspace_path: string;
  admin_runtime: string;
  team_runtime: string;
  user_runtime: string;
};
```

이 설계의 의미는 다음과 같다.

- 런타임은 파일 경로만으로 식별되지 않는다
- 팀 경계와 사용자 경계가 같이 반영돼야 한다
- route, session, channel, dashboard state가 같은 runtime identity를 사용해야 한다

상세적인 runtime lifecycle과 rebinding 전략은 `improved`에서 관리하지만, 상위 설계 개념은 이 runtime identity 모델을 기준으로 한다.

## 리소스 스코프 모델

멀티테넌트에서 모든 자산이 같은 범위로 저장되면 안 된다.
이 프로젝트는 세 단계의 scope 개념을 사용한다.

- `global`
  - 시스템 전체에서 공유되는 자산
- `team`
  - 같은 팀에서 공유되는 자산
- `personal`
  - 한 사용자에게만 속한 자산

이 scope 모델은 다음 저장소에 공통으로 적용된다.

- provider
- agent definition
- template
- workflow preset
- memory
- references
- 일부 dashboard state

상위 설계의 핵심은 “모든 자산을 한 저장소에 넣느냐”가 아니라, **읽기와 쓰기 모두에서 scope 해석 규칙이 일관되어야 한다**는 점이다.

## Provider / Definition 해석

provider와 definition은 단순 전역 목록이 아니라, 요청자의 문맥에 따라 보이는 범위가 달라져야 한다.

기본 해석 순서는 다음과 같다.

```text
visible resources
  = global
  + current team
  + current personal scope
```

쓰기 권한은 더 엄격하다.

- `global`은 관리자 전용
- `team`은 팀 관리 권한이 필요
- `personal`은 본인만 수정 가능

이 구조는 “보이는 것”과 “수정 가능한 것”을 분리해 설명해야 한다.

## 세션과 채널

멀티테넌트에서 세션 키와 채널 저장소는 사용자/팀 분리가 보장돼야 한다.

이 설계는 다음 원칙을 따른다.

- 채팅 세션 키는 팀과 사용자를 모두 반영한다
- channel instance 저장소는 팀 runtime 아래에 위치한다
- ownership / write guard는 team context를 기준으로 검사한다
- SSE 구독과 broadcast도 팀 경계를 반영한다

즉 세션과 채널은 UI 기능이 아니라 tenant boundary를 실질적으로 강제하는 계층이다.

## Memory와 개인 자산

memory, references, skill upload 같은 개인 자산은 사용자별 runtime 또는 user content 경로에 귀속된다.

이 설계의 의도는 다음과 같다.

- 개인 대화와 개인 memory는 다른 사용자가 공유하지 않는다
- 팀 전환 시 개인 자산 경로도 함께 바뀐다
- team-scoped 자산과 personal 자산을 같은 root에 섞지 않는다

이 원칙은 tool budget과 session reuse 같은 상위 정책에도 중요하다.
잘못된 scope에서 과거 memory를 재사용하면 tenant boundary가 깨지기 때문이다.

## 관리자와 팀 관리자

멀티테넌트 설계는 권한 계층도 분리해서 설명해야 한다.

- `superadmin`
  - 전역 설정, 전역 provider, 모든 팀 관리
- `team owner/manager`
  - 자신의 팀 멤버와 팀 리소스 관리
- `member/viewer`
  - 개인 리소스 중심 사용

이 구분은 단순 role string이 아니라 다음 정책에 영향을 준다.

- 어떤 scope에 쓸 수 있는지
- 어떤 팀으로 전환할 수 있는지
- 어떤 API가 허용되는지
- 어떤 dashboard 화면이 노출되는지

## 경계

이 설계가 하지 않는 일도 명확하다.

- workflow 단계 관리 자체를 설명하지 않는다
- observability나 eval 결과 저장 방식을 정의하지 않는다
- provider 구체 구현체의 네트워크 동작을 정의하지 않는다
- feedback loop의 합의 상태를 기록하지 않는다

즉 `multi-tenant`는 권한, 문맥, 저장소, runtime identity를 정의하는 설계이지, 프로젝트 진행 상태를 기록하는 문서가 아니다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 로컬 우선 워크스페이스와 dashboard, channel, workflow를 한 시스템 안에서 운영한다.
그 구조에서는 멀티테넌트를 다음처럼 이해해야 한다.

- 팀이 tenant boundary다
- 사용자는 팀 안의 실행 주체다
- workspace는 개인 실행 공간이다
- 요청 문맥, 세션, 채널, 저장소는 모두 같은 tenant identity를 공유해야 한다

이 문서는 그 상위 설계 개념을 고정한다.
세부 구현 순서, migration, 남은 work breakdown은 `docs/*/design/improved/*`에서 관리한다.
