# 셸 명령 패턴 레퍼런스

## 파일 탐색

```bash
# 패턴으로 파일 찾기
find . -name "*.ts" -type f
# 최근 수정 파일
find . -type f -printf '%T@ %p\n' | sort -rn | head -10
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

```bash
# 파일 읽기
cat file.txt
head -50 file.txt
# 라인 수
wc -l file.txt
# 치환
sed -i 's/old/new/g' file.txt
```

## 프로세스 / 시스템

```bash
# 프로세스 목록
ps aux --sort=-%cpu | head -10
# 포트 사용 확인
ss -tlnp | grep ":3000"
# 환경변수
echo "$PATH" | tr ':' '\n'
env
```

## JSON 처리

```bash
# 파싱 (jq)
jq '.items[] | select(.active == true)' data.json
# 키 추출
jq -r '.name' data.json
# 생성
echo '{"name":"Alice","age":30}' | jq .
```

## 네트워크

```bash
# HTTP 요청
curl -s "https://api.example.com/data" | jq .
curl -o output.html "https://example.com"
# 연결 테스트
curl -s -o /dev/null -w "%{http_code}" "https://example.com"
nc -zv example.com 443
```

## 원칙

- 읽기 전용 명령으로 먼저 탐색, 쓰기 작업은 이후
- 파이프 체인은 3단계 이하로 유지
- 경로는 절대경로 또는 workspace 기준 상대경로
