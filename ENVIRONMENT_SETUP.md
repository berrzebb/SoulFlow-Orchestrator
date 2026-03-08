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
# 워크스페이스
WORKSPACE=/custom/path ./run.sh dev

# 웹 포트
WEB_PORT=8080 ./run.sh dev

# Redis 포트
REDIS_PORT=6380 ./run.sh dev

# 모두 지정
WORKSPACE=/custom/path WEB_PORT=8080 REDIS_PORT=6380 ./run.sh dev
```

**Windows (Cmd):**
```cmd
run.cmd dev WORKSPACE=D:\custom\path
run.cmd dev WEB_PORT=8080
run.cmd dev REDIS_PORT=6380
```

**Windows (PowerShell):**
```powershell
$env:WORKSPACE='D:\custom\path' .\run.ps1 dev
$env:WEB_PORT=8080 .\run.ps1 dev
$env:REDIS_PORT=6380 .\run.ps1 dev
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
