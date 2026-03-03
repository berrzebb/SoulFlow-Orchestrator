# Container Basics

## 런타임 선택

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
```

podman 우선, 없으면 docker. 둘 다 없으면 에러 — 호스트 폴백 없음.

## 컨테이너 이름 생성

```powershell
$N = "sbx-$([guid]::NewGuid().ToString('N').Substring(0,8))"
```

충돌 방지용 랜덤 suffix. 강제 정리 시 `& $R rm -f $N` 에서 사용.

## 볼륨 마운트

```powershell
-v "${PWD}:/workspace:rw" -w /workspace
```

- 호스트 `PWD` ↔ 컨테이너 `/workspace` 양방향 마운트
- 스크립트는 workspace에 먼저 `write_file`로 저장 후 실행
- 생성된 파일도 `/workspace`에 저장하면 호스트에서 바로 접근 가능

## 이미지 선택 가이드

| 필요한 것 | 이미지 | 비고 |
|-----------|--------|------|
| Python + pip | `python:3.12-slim` | 기본 선택 |
| Python + 한글 폰트 | `python:3.12-slim` + `apt fonts-nanum` | PDF/문서 생성 시 |
| PostgreSQL CLI | `postgres:16` | psql 포함 |
| MySQL CLI | `mysql:8` | mysql 포함 |
| Node.js + npm | `node:20-slim` | JS 스크립트 |
| Ubuntu (apt 자유) | `ubuntu:24.04` | 범용 CLI 도구 |
| Alpine (초경량) | `alpine:3.19` | 크기 최소화 |

이미지는 Docker Hub에서 자동 pull — 네트워크 연결 필요. 이미 pull된 이미지는 캐시 재사용.

## 실행 모드

### One-shot (즉시 실행 + 자동 제거)

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim python script.py
```

### Detached (백그라운드 서버, 수동 정리 필요)

```powershell
& $R run -d --rm --name $N -p "55432:5432" postgres:16
# ... 작업 ...
& $R stop $N   # 또는 rm -f $N
```

## 정리 패턴

| 상황 | 명령 |
|------|------|
| `--rm` one-shot | 자동 제거 |
| detached 정상 종료 | `& $R stop $N` |
| 강제 종료 | `& $R rm -f $N` |
| 이미지 제거 | `& $R rmi <image>` |

## stdin 파이프

```powershell
# SQL 파일을 psql에 stdin으로 전달
Get-Content query.sql -Raw | & $R exec -i $N psql -U postgres -d appdb
```
