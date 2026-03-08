# 환경 관리

## 사용할 수 있는 환경

| 환경 | 포트 | 용도 |
|------|------|------|
| dev | 4200 | 개발 |
| test | 4201 | 테스트 |
| staging | 4202 | 배포 전 점검 |
| prod | 4200 | 실제 운영 |

## 커스텀 설정으로 실행하기

**Linux/macOS:**
```bash
./run.sh dev --workspace=/custom/path
./run.sh dev --web-port=8080
./run.sh dev --redis-port=6380
./run.sh dev --workspace=/custom/path --web-port=8080 --redis-port=6380
```

**Windows (Cmd):**
```cmd
run.cmd dev --workspace=D:\custom\path
run.cmd dev --web-port=8080
run.cmd dev --redis-port=6380
run.cmd dev --workspace=D:\custom\path --web-port=8080 --redis-port=6380
```

**Windows (PowerShell):**
```powershell
.\run.ps1 dev --workspace=D:\custom\path
.\run.ps1 dev --web-port=8080
.\run.ps1 dev --redis-port=6380
.\run.ps1 dev --workspace=D:\custom\path --web-port=8080 --redis-port=6380
```

## 환경 중지하기

**Linux/macOS:**
```bash
./run.sh down
```

**Windows:**
```cmd
run.cmd down
```

## 웹 브라우저에서 접속

`http://localhost:4200` (또는 사용 중인 포트)

## Docker Compose 파일

설정 파일은 자동으로 `docker/` 디렉토리에 생성됩니다:

- `docker/docker-compose.dev.yml` — 개발 환경
- `docker/docker-compose.test.yml` — 테스트 환경
- `docker/docker-compose.staging.yml` — 스테이징 환경
- `docker/docker-compose.prod.yml` — 프로덕션 환경
