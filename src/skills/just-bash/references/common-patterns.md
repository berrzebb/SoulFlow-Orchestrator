# 셸 명령 패턴 레퍼런스

## 파일 탐색

```powershell
# 패턴으로 파일 찾기
Get-ChildItem -Recurse -Filter "*.ts"
# 최근 수정 파일
Get-ChildItem -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 10
# 내용 검색 (rg 선호)
rg "pattern" src/ --type ts
rg "TODO" . -l  # 파일 목록만
```

## Git

```bash
# 상태 확인
git status --short
git log --oneline -20
git diff HEAD~1
# 브랜치
git branch -a
git log --oneline --graph --decorate -15
# 스테이징
git add -p  # 인터랙티브 (tmux 스킬 사용)
git diff --staged
```

## 텍스트 처리

```powershell
# 파일 읽기
Get-Content file.txt
Get-Content file.txt | Select-Object -First 50
# 라인 수
(Get-Content file.txt).Count
# 치환
(Get-Content file.txt) -replace "old", "new" | Set-Content file.txt
```

## 프로세스 / 시스템

```powershell
# 프로세스 목록
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
# 포트 사용 확인
netstat -ano | findstr ":3000"
# 환경변수
$env:PATH -split ";"
[System.Environment]::GetEnvironmentVariables()
```

## JSON 처리

```powershell
# 파싱
$data = Get-Content data.json | ConvertFrom-Json
$data.items | Where-Object { $_.active -eq $true }
# 생성
@{ name = "Alice"; age = 30 } | ConvertTo-Json
```

## 네트워크

```powershell
# HTTP 요청
Invoke-RestMethod "https://api.example.com/data"
Invoke-WebRequest "https://example.com" -OutFile output.html
# 연결 테스트
Test-NetConnection -ComputerName "example.com" -Port 443
```

## 원칙

- 읽기 전용 명령으로 먼저 탐색, 쓰기 작업은 이후
- 파이프 체인은 3단계 이하로 유지
- 경로는 절대경로 또는 workspace 기준 상대경로
