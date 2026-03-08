# 설계: 다중 환경 설정 — 컨테이너 기반 격리 실행

> **상태**: 구현 완료

## 개요

다중 환경 설정(Multi-Environment Setup)은 SoulFlow Orchestrator를 위한 격리된 컨테이너 실행 환경(개발, 테스트, 스테이징, 프로덕션)을 제공합니다. 사용자는 한 줄의 명령(`make dev` 또는 `run.cmd dev`)을 실행하면 시스템이 모든 설정, Docker 구성, 서비스 초기화를 자동으로 처리합니다.

핵심 원칙: **사용자는 npm, docker 명령, Node.js 버전을 이해할 필요가 없어야 한다.**

## 문제 정의

- **이전**: 사용자가 수동으로 `npm install`, `npm run build`, `docker compose up` 등을 실행
- **문제**: 비개발자 사용자는 시스템을 사용할 수 없었고, 같은 머신의 여러 사용자 간에 환경 충돌 발생
- **해결**: 환경별 단일 명령어 + 컨테이너 빌드를 통한 사용자별 자동 격리

## 아키텍처

```
사용자 실행: ./run.sh dev  또는  run.cmd dev  또는  .\run.ps1 dev
    ↓
셸 스크립트 (run.sh / run.cmd / run.ps1)
    ↓
setup-environment.js (docker-compose.{profile}.yml + .env.{profile} 생성)
    ↓
docker compose up -d (격리된 컨테이너 시작)
    ↓
애플리케이션 http://localhost:4200에서 실행
```

## 환경 프로필

| 프로필 | 포트 | Redis | 목적 | 워크스페이스 |
|--------|------|-------|------|------------|
| dev | 4200 | 6379 | 개발, 자동 리로드 | `/data/workspace-dev` |
| test | 4201 | 6380 | 테스트, CI/CD 격리 | `/data/workspace-test` |
| staging | 4202 | 6381 | 배포 전 검증 | `/data/workspace-staging` |
| prod | 4200 | 6379 | 프로덕션 배포 | `/data` |

## 주요 기능

### 1. 플랫폼 중립적 진입점

동일한 명령 인터페이스를 갖는 세 가지 스크립트:
- **Makefile** (Linux/macOS): `make dev`, `make down` 등
- **run.cmd** (Windows 명령 프롬프트): `run.cmd dev`, `run.cmd down` 등
- **run.ps1** (Windows PowerShell): `.\run.ps1 dev`, `.\run.ps1 down` 등

모두 동일한 JavaScript 설정 생성기(`setup-environment.js`)로 위임합니다.

### 2. 동적 Docker Compose 생성

- `setup-environment.js`가 런타임에 `docker-compose.{profile}.yml` 생성
- `WORKSPACE` 환경변수를 통해 커스텀 워크스페이스 경로 지원
- 공유 시스템에서의 사용자별 프로젝트 격리: `soulflow-{profile}-{username}`

### 3. 컨테이너 전용 Node 모듈

- `.dockerignore`는 Docker 컨텍스트에서 로컬 `node_modules` 제외
- 모든 빌드는 컨테이너 내부에서 수행 (깨끗한 환경)
- 사용자는 로컬에서 `npm install`을 실행할 필요 없음

### 4. 비기술적 문서

- **QUICKSTART.md**: 3단계 (Docker 설치 → 명령 실행 → 브라우저 열기)
- **ENVIRONMENT_SETUP.md**: 최소한의 운영 정보 (포트 표, 워크스페이스 재정의, 중지 명령)
- **README.md 빠른 시작**: 설정 마법사가 설정 안내 (수동 `.env` 편집 불필요)

## 수정된 파일

### 스크립트 진입점
- `Makefile` — Unix/Linux/macOS 셸 스크립트 인터페이스
- `run.cmd` — Windows 배치 스크립트 인터페이스
- `run.ps1` — Windows PowerShell 스크립트 인터페이스
- `setup-environment.js` — 동적 Docker Compose + .env 파일 생성기

### 설정
- `.env.example` — 사용자 친화적 설정 템플릿
- `docker-compose.dev.yml`, `.test.yml`, `.staging.yml` — 환경별 자동 생성

### 문서
- `QUICKSTART.md` — 3단계로 단순화, npm/Node.js/Git 참조 제거
- `ENVIRONMENT_SETUP.md` — 최소한의 운영 가이드 (45줄 → 400+ 줄의 기술 세부 정보 제거)
- `README.md` (빠른 시작 섹션) — 비기술적 빠른 시작 가이드

### 제거/단순화
- 삭제: 모든 `npm run env:*` 스크립트 (불필요한 추상화 계층)
- 문서에서 제거: npm install, npm build, docker exec, Node.js 버전 요구사항, .env 수동 편집

## 타입 설계

### EnvProfile (setup-environment.js)

```typescript
interface EnvProfile {
  name: string;                    // 표시 이름 (예: "Development")
  projectName: string;             // Docker 프로젝트 식별자
  webPort: number;                 // 웹 서버 포트
  redisPort: number;               // Redis 포트
  workspace: string;               // 컨테이너 워크스페이스 경로
  nodeEnv: "development" | "test" | "production";
  debug: "true" | "false";
  composeFile: string;             // 출력 파일명
  buildTarget: "dev" | "production" | "full";
}

const ENV_PROFILES: Record<string, EnvProfile> = {
  dev: { ... },
  test: { ... },
  staging: { ... },
  prod: { ... },
};
```

## 실행 흐름

```
1. 사용자 입력: make dev
   ↓
2. Makefile은 .env를 읽거나 CLI WORKSPACE 변수 읽음
   ↓
3. 실행: WORKSPACE=/custom/path node setup-environment.js dev
   ↓
4. setup-environment.js:
   - ENV_PROFILES["dev"] 읽음
   - WORKSPACE 환경변수가 설정되면 workspace 재정의
   - docker-compose.dev.yml 생성
   - .env.dev 생성
   - 요약 출력
   ↓
5. docker compose -f docker-compose.dev.yml up -d
   ↓
6. 컨테이너 시작, npm build + dev 서버가 컨테이너 내부에서 실행
   ↓
7. 사용자가 http://localhost:4200에 접속
```

## 사용자 격리 (공유 시스템)

시작 중에 `WORKSPACE` 환경변수가 설정된 경우:

```bash
WORKSPACE=/home/alice/workspace make dev
```

시스템은:
1. 데이터 지속성을 위해 커스텀 워크스페이스 사용
2. 프로젝트 이름 수정: `soulflow-dev-alice` (포트/볼륨 충돌 방지)
3. 각 사용자는 격리됨: 컨테이너, 볼륨, 데이터

## 테스트

- 수동: `make dev`, `make test`, `make staging`, `make prod`
- 확인: `http://localhost:{port}` 응답 확인
- 중지: `make down`
- 여러 환경: 별도 터미널에서 동시 실행
- 커스텀 워크스페이스: `WORKSPACE=/custom/path make dev`

## 문서 기준

모든 사용자 대면 문서는 **비기술적, 운영 친화적** 스타일을 따릅니다:
- ❌ npm, Node.js 버전, docker 명령, .env 파일 구문 언급 금지
- ✅ 간단한 작업 중심 언어: "Docker 설치", "이 명령 실행", "브라우저 열기"
- ✅ 최소 명령 블록, 빌드 프로세스 설명 없음
- ✅ 참조 스타일 (튜토리얼 스타일 아님) 구조

## 기존 작업에 미치는 영향

- **CI/CD**: Docker 기반 빌드는 영향 없음; 모든 컴파일은 여전히 컨테이너에서 발생
- **개발**: `make dev`가 이전의 수동 `npm install + npm run dev` 단계 대체
- **테스트**: 별도의 `make test` 환경은 테스트 실행을 격리 상태로 유지
- **문서**: 모든 가이드 (QUICKSTART, ENVIRONMENT_SETUP, README) 단순화
