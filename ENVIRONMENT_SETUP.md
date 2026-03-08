# 환경 관리

## 사용할 수 있는 환경

| 환경 | 포트 | 용도 |
|------|------|------|
| dev | 4200 | 개발 |
| test | 4201 | 테스트 |
| staging | 4202 | 배포 전 점검 |
| prod | 4200 | 실제 운영 |

## 특정 폴더에서 실행하기

특정 폴더를 사용하여 실행하려면:

**Linux/macOS:**
```bash
WORKSPACE=/경로/입력 ./run.sh dev
```

**Windows:**
```cmd
run.cmd dev WORKSPACE=D:\경로\입력
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
