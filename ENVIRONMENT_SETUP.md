# 🚀 SoulFlow Orchestrator 환경 관리 가이드

실 사용자를 위한 **3가지 환경** (개발/테스트/프로덕션)을 간편하게 관리하는 스크립트입니다.

## 📋 스크립트 선택 가이드

**어떤 스크립트를 사용할까요?**

| 상황 | 추천 | 명령어 |
|------|------|--------|
| **Linux/macOS 빠른 실행** | Makefile | `make dev` |
| **Linux/macOS 상세 메뉴** | setup-env.sh | `bash setup-env.sh` |
| **Windows (Cmd) 빠른 실행** | run.cmd | `run.cmd dev` |
| **Windows (PowerShell) 빠른 실행** | run.ps1 | `.\run.ps1 dev` |
| **Windows (PowerShell) 상세 메뉴** | setup-env.ps1 | `.\setup-env.ps1` |
| **모든 플랫폼 npm** | npm | `npm run env:dev` |

**권장:**
- **처음 사용할 때**: `make dev` (Linux/macOS) 또는 `run.cmd dev` (Windows)
- **상세한 옵션이 필요할 때**: 대화형 메뉴 (`bash setup-env.sh` 또는 `.\setup-env.ps1`)
- **CI/CD 파이프라인**: npm 스크립트

---

## 📋 지원하는 환경

| 환경 | 포트 | Redis | 용도 | 볼륨 |
|------|------|-------|------|------|
| **개발 (dev)** | 4200 | 6379 | 로컬 개발, 소스 마운트 | 별도 |
| **테스트 (test)** | 4201 | 6380 | 테스트 및 CI/CD | 별도 |
| **스테이징** | 4202 | 6381 | 프로덕션 배포 전 검증 | 별도 |
| **프로덕션** | 4200 | 6379 | 실제 운영 환경 | 공유 |

---

## 🎯 빠른 시작 (권장)

### Linux / macOS - Makefile 사용 (가장 간단)

```bash
# 개발 환경 시작
make dev

# 또는 다른 환경
make test
make staging
make prod

# 상태 확인
make status

# 중지
make down
```

### Windows - 배치 스크립트 사용

#### Cmd (명령 프롬프트)
```cmd
# 개발 환경 시작
run.cmd dev

# 또는 다른 환경
run.cmd test
run.cmd staging
run.cmd prod

# 상태 확인
run.cmd status

# 중지
run.cmd down
```

#### PowerShell
```powershell
# 실행 권한 허용 (처음 한 vez만)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 개발 환경 시작
.\run.ps1 dev

# 또는 다른 환경
.\run.ps1 test
.\run.ps1 staging
.\run.ps1 prod

# 상태 확인
.\run.ps1 status

# 중지
.\run.ps1 down
```

### npm 스크립트 사용 (모든 플랫폼)

```bash
npm run env:dev
npm run env:test
npm run env:staging
npm run env:prod
npm run env:down
npm run env:status
```

### 대화형 메뉴 (모든 플랫폼)

```bash
# Linux/macOS
bash setup-env.sh

# Windows PowerShell
.\setup-env.ps1
```

---

## 📚 상세 사용법

### 1️⃣ 개발 환경 (Development)

**특징:**
- 소스 코드가 컨테이너에 마운트됨
- 파일 변경 시 자동 리로드 (`npm run dev`)
- 디버그 모드 활성화
- 별도 Redis 포트 (6379)

```bash
# 시작
npm run env:dev

# 또는 수동으로
node setup-environment.js dev
docker compose -f docker-compose.dev.yml up -d

# 확인
docker compose -f docker-compose.dev.yml ps

# 로그 보기
docker compose -f docker-compose.dev.yml logs -f orchestrator

# 중지
docker compose -f docker-compose.dev.yml down

# 볼륨 포함 완전 정리
docker compose -f docker-compose.dev.yml down -v
```

**접근:**
```
웹: http://localhost:4200
Redis: redis://localhost:6379
```

### 2️⃣ 테스트 환경 (Test)

**특징:**
- 프로덕션과 같은 빌드
- 포트 충돌 방지 (4201)
- 격리된 데이터 (별도 볼륨)
- CI/CD 파이프라인용

```bash
# 시작
npm run env:test

# 컨테이너에서 테스트 실행
docker exec -it soulflow-test-orchestrator npm test

# 빌드 검증
docker exec -it soulflow-test-orchestrator npm run build

# 타입체크
docker exec -it soulflow-test-orchestrator npm run typecheck
```

**접근:**
```
웹: http://localhost:4201
Redis: redis://localhost:6380
```

### 3️⃣ 스테이징 환경 (Staging)

**특징:**
- 프로덕션 빌드 (`target: production`)
- 디버그 모드 비활성화
- 포트 4202로 격리
- 배포 전 최종 검증용

```bash
# 시작
npm run env:staging

# 프로덕션 빌드 검증
docker exec -it soulflow-staging-orchestrator npm run quality
```

**접근:**
```
웹: http://localhost:4202
Redis: redis://localhost:6381
```

### 4️⃣ 프로덕션 환경 (Production)

```bash
# 시작
npm run env:prod

# 또는 docker compose 직접 사용
docker compose up -d
```

---

## 🔧 환경 파일 이해

각 환경 시작 시 다음 파일들이 자동으로 생성됩니다:

### docker-compose.{profile}.yml
- 서비스 정의 (orchestrator, redis)
- 포트 매핑
- 볼륨 설정
- 리소스 제한

### .env.{profile}
- 환경변수 설정
- 애플리케이션 설정값
- 경로 설정

**예시: .env.test**
```bash
COMPOSE_PROJECT_NAME=soulflow-test
NODE_ENV=test
WORKSPACE=/data/workspace-test
REDIS_PORT=6380
DEBUG=true
```

---

## 📊 상태 확인 및 관리

### 모든 환경 상태 조회

```bash
npm run env:status
# 또는
docker compose ps
```

### 특정 환경 로그

```bash
# 개발 환경 로그
docker compose -f docker-compose.dev.yml logs -f

# 테스트 환경 로그
docker compose -f docker-compose.test.yml logs -f

# 특정 서비스만
docker compose -f docker-compose.dev.yml logs -f orchestrator
```

### 컨테이너 접속

```bash
# 개발 환경
docker exec -it soulflow-dev-orchestrator bash

# 테스트 환경
docker exec -it soulflow-test-orchestrator bash

# Redis CLI (개발)
docker exec -it soulflow-dev-redis redis-cli
```

---

## 🧹 정리 및 초기화

### 단일 환경 중지 및 정리

```bash
# 개발 환경 중지
docker compose -f docker-compose.dev.yml down

# 볼륨 포함 완전 정리
docker compose -f docker-compose.dev.yml down -v
```

### 모든 환경 중지

```bash
npm run env:down

# 또는 스크립트 사용
bash setup-env.sh  # 메뉴에서 선택
.\setup-env.ps1    # PowerShell
```

### 캐시 및 이미지 정리

```bash
# 사용하지 않는 이미지 삭제
docker image prune -a

# 볼륨 정리
docker volume prune

# 네트워크 정리
docker network prune
```

---

## 🐛 트러블슈팅

### 포트 충돌

```bash
# 포트 4200이 이미 사용 중인 경우
lsof -i :4200  # macOS/Linux
netstat -ano | findstr :4200  # Windows

# 충돌하는 프로세스 중지
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### 이미지 빌드 실패

```bash
# 캐시 무효화하고 재빌드
docker compose -f docker-compose.dev.yml build --no-cache

# 또는 이미지 삭제 후 다시
docker rmi soulflow-dev-orchestrator
npm run env:dev
```

### Redis 연결 실패

```bash
# Redis 상태 확인
docker compose -f docker-compose.dev.yml ps redis

# Redis 재시작
docker compose -f docker-compose.dev.yml restart redis

# 또는 볼륨 포함 재생성
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```

### 볼륨 권한 문제 (Linux)

```bash
# 볼륨 소유권 변경
sudo chown -R 1000:1000 /var/lib/docker/volumes/soulflow-dev-workspace/_data
```

---

## 📝 npm 스크립트 요약

```bash
npm run env:setup      # 대화형 설정 (프로필 선택)
npm run env:dev        # 개발 환경 시작
npm run env:test       # 테스트 환경 시작
npm run env:staging    # 스테이징 환경 시작
npm run env:prod       # 프로덕션 환경 시작
npm run env:down       # 모든 환경 중지
npm run env:status     # 환경 상태 확인
npm run env:logs       # 로그 보기
```

---

## 🔐 보안 고려사항

- **프로덕션 환경**: 외부에서는 방화벽으로 접근 제한
- **Redis**: 패스워드 설정 권장 (프로덕션)
- **환경변수**: `.env.prod`는 버전 관리에서 제외 (`.gitignore`)
- **이미지**: 정기적으로 업데이트하고 보안 패치 적용

---

## 💡 팁

### 동시에 여러 환경 실행

```bash
# 개발 + 테스트 동시 실행
npm run env:dev &
npm run env:test &

# 또는 각각 다른 터미널에서
# 터미널 1: npm run env:dev
# 터미널 2: npm run env:test
```

### 환경 간 데이터 마이그레이션

```bash
# 개발 환경의 Redis 백업
docker exec soulflow-dev-redis redis-cli SAVE

# 파일로 추출
docker cp soulflow-dev-redis:/data/dump.rdb ./dump.rdb

# 테스트 환경에 복원
docker cp ./dump.rdb soulflow-test-redis:/data/
docker exec soulflow-test-redis redis-cli SHUTDOWN
docker compose -f docker-compose.test.yml restart redis
```

### 커스텀 환경 추가

[setup-environment.js](setup-environment.js)의 `ENV_PROFILES`에 새로운 프로필 추가:

```javascript
custom: {
  name: 'Custom',
  projectName: 'soulflow-custom',
  webPort: 4203,
  redisPort: 6382,
  workspace: '/data/workspace-custom',
  nodeEnv: 'development',
  // ...
}
```

그 후:
```bash
node setup-environment.js custom
docker compose -f docker-compose.custom.yml up -d
```

---

## 📞 문제 보고

이슈 발생 시 다음 정보를 함께 제공하면 도움이 됩니다:

```bash
# 환경 정보 수집
docker --version
docker compose version
npm --version
node --version

# 관련 로그 수집
docker compose -f docker-compose.dev.yml logs orchestrator > logs.txt
docker compose -f docker-compose.dev.yml ps > status.txt
```

---

**작성일**: 2026-03-08
**마지막 업데이트**: 2026-03-08
