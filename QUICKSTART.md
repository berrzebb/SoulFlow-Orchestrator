# 🚀 SoulFlow Orchestrator - 빠른 시작

> **⚡ 정말 간단합니다: 이 명령어 하나만 실행하세요!**
> ```bash
> make dev                    # Linux/macOS
> run.cmd dev                 # Windows Cmd
> .\run.ps1 dev               # Windows PowerShell
> ```
>
> **나머지는 모두 자동입니다** ✨

---

## ⚡ 5초 시작 가이드

```bash
git clone ...
cd soulflow-orchestrator
make dev              # 또는 run.cmd dev (Windows)
# → http://localhost:4200 열기
```

**끝입니다!** npm install, 빌드, 서버 실행 모두 자동 🚀

---

## ✅ 사전 요구사항 (Prerequisites)

**필수:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (또는 Podman)
- [Node.js 22+](https://nodejs.org/)
- [Git](https://git-scm.com/)

**Linux/macOS 추가:**
- GNU Make (`make` 명령어)
  ```bash
  # macOS: Homebrew 사용
  brew install make

  # Ubuntu/Debian
  sudo apt-get install make

  # CentOS/RHEL
  sudo yum install make
  ```

**확인:**
```bash
# Linux/macOS
node --version      # v22.x.x
docker --version    # Docker version 24+
make --version      # GNU Make 4.x

# Windows (Cmd)
node --version      # v22.x.x
docker --version    # Docker version 24+
```

---

## 🔧 초기 설정 (One-time Setup)

### 1️⃣ 프로젝트 클론 또는 다운로드

```bash
# GitHub에서 클론
git clone https://github.com/your-org/soulflow-orchestrator.git
cd soulflow-orchestrator

# 또는 다운로드한 폴더로 이동
cd /path/to/soulflow-orchestrator
```

### 2️⃣ 환경 설정 (선택사항)

```bash
# .env 파일 생성 (기본값 사용 가능)
cp .env.example .env

# 필요시 워크스페이스 경로 변경
# vi .env  또는  code .env
```

**이제 준비 완료!** npm 설치나 빌드는 **자동으로 컨테이너에서 실행됩니다** 👇

---

## 📌 중요: 사용자 격리

- **npm install**: 자동으로 컨테이너에서 실행 ✅
- **node_modules**: 컨테이너 내부에만 생성 ✅
- **워크스페이스**: 각 사용자별로 격리됨 ✅
- **수동 작업 불필요**: make dev 하나만 실행하면 됨 ✅

---

## 🎯 1단계: 환경 시작 (모두 동일)

### Linux / macOS
```bash
make dev
```

### Windows (명령 프롬프트)
```cmd
run.cmd dev
```

### Windows (PowerShell)
```powershell
.\run.ps1 dev
```

**완료!** 웹 브라우저에서 **http://localhost:4200** 을 열어보세요 🎉

---

## 📋 주요 명령어

모든 플랫폼에서 동일하게 동작합니다:

| 명령어 | 설명 | Linux/macOS | Windows (Cmd) | Windows (PS) |
|--------|------|-------------|---------------|-------------|
| **시작** | 개발 환경 | `make dev` | `run.cmd dev` | `.\run.ps1 dev` |
| | 테스트 환경 | `make test` | `run.cmd test` | `.\run.ps1 test` |
| | 스테이징 환경 | `make staging` | `run.cmd staging` | `.\run.ps1 staging` |
| | 프로덕션 환경 | `make prod` | `run.cmd prod` | `.\run.ps1 prod` |
| **확인** | 상태 보기 | `make status` | `run.cmd status` | `.\run.ps1 status` |
| | 로그 보기 | `make logs` | `run.cmd logs` | `.\run.ps1 logs` |
| **정리** | 중지 | `make down` | `run.cmd down` | `.\run.ps1 down` |
| | 완전 정리 | `make clean` | `run.cmd clean` | `.\run.ps1 clean` |

---

## 🌍 환경 비교

| 환경 | 용도 | 포트 | Redis | 특징 |
|------|------|------|-------|------|
| **dev** | 로컬 개발 | 4200 | 6379 | 소스 마운트, 자동 리로드 |
| **test** | 테스트/CI | 4201 | 6380 | 격리된 환경 |
| **staging** | 배포 전 검증 | 4202 | 6381 | 프로덕션과 동일 |
| **prod** | 실제 운영 | 4200 | 6379 | 공식 환경 |

---

## 🐛 트러블슈팅

### "command not found: make" (macOS/Linux)

```bash
# Homebrew로 설치
brew install make

# 또는 개발 도구 설치
xcode-select --install
```

### "Docker is not running"

Docker Desktop을 실행해주세요. (macOS/Windows)

### "port 4200 already in use"

다른 포트 사용:
- `make test` → 4201
- `make staging` → 4202

또는 충돌하는 프로세스 중지:
```bash
# macOS/Linux
lsof -i :4200
kill -9 <PID>

# Windows
netstat -ano | findstr :4200
taskkill /PID <PID> /F
```

### PowerShell에서 "실행 불가" 에러

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 📚 다음 단계

### 개발 시작하기

```bash
# 개발 환경 실행
make dev

# 또 다른 터미널에서 파일 변경 감시
npm run dev
```

### 테스트 실행

```bash
# 유닛 테스트
make build
make test-unit

# 품질 검사 (빌드 + 린트 + 테스트)
make quality
```

### 상세 가이드

더 많은 정보는 [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md)를 참조하세요.

---

## ⚡ npm 스크립트 (모든 플랫폼)

Makefile/run.cmd/run.ps1 대신 npm을 사용할 수도 있습니다:

```bash
npm run env:dev      # 개발 환경 시작
npm run env:test     # 테스트 환경 시작
npm run env:staging  # 스테이징 환경 시작
npm run env:prod     # 프로덕션 환경 시작
npm run env:down     # 중지
npm run env:status   # 상태 확인
npm run env:logs     # 로그 보기
```

---

## 🎯 일반적인 작업 흐름

### 1️⃣ 로컬 개발

```bash
# 1. 개발 환경 시작
make dev

# 2. 브라우저에서 http://localhost:4200 열기
# 3. 코드 수정 → 자동 리로드 (핫 리로드 활성화된 경우)

# 4. 완료 후 중지
make down
```

### 2️⃣ 테스트 및 검증

```bash
# 1. 테스트 환경 시작
make test

# 2. 컨테이너에서 테스트 실행
docker exec -it soulflow-test-orchestrator npm test

# 3. 완료 후 중지
make down
```

### 3️⃣ 배포 전 최종 검증

```bash
# 1. 스테이징 환경 시작
make staging

# 2. 프로덕션 설정으로 테스트
docker exec -it soulflow-staging-orchestrator npm run quality

# 3. 완료 후 중지
make down

# 4. 프로덕션 배포
make prod
```

---

## 📞 도움이 필요하신가요?

1. **[ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md)** - 상세 가이드
2. **[ENVIRONMENT_SETUP.md#-트러블슈팅](ENVIRONMENT_SETUP.md#-트러블슈팅)** - 문제 해결
3. **GitHub Issues** - 버그 보고

---

## 💡 팁

### 동시에 여러 환경 실행하기

```bash
# 터미널 1
make dev

# 터미널 2
make test

# 터미널 3
make staging
```

### 환경 간 빠른 전환

```bash
# 현재 환경 중지
make down

# 다른 환경 시작
make test
```

### 로그 실시간 모니터링

```bash
make logs
# (Ctrl+C로 종료)
```

---

**준비 완료! 행운을 빕니다! 🚀**
