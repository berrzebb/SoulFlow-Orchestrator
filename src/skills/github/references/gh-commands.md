# gh CLI 명령어 레퍼런스

## Pull Request

```bash
# 목록
gh pr list --repo owner/repo --state open --json number,title,author
# 상세
gh pr view 55 --repo owner/repo
# CI 상태
gh pr checks 55 --repo owner/repo
# 리뷰어 상태
gh pr view 55 --repo owner/repo --json reviews,reviewRequests
# Diff
gh pr diff 55 --repo owner/repo
# 머지
gh pr merge 55 --repo owner/repo --squash
```

## Issues

```bash
# 목록
gh issue list --repo owner/repo --state open --label bug
# 생성
gh issue create --repo owner/repo --title "제목" --body "내용" --label bug
# 닫기
gh issue close 42 --repo owner/repo
# 댓글
gh issue comment 42 --repo owner/repo --body "댓글 내용"
```

## CI/CD (Actions)

```bash
# 워크플로우 실행 목록
gh run list --repo owner/repo --limit 10
# 실행 상세
gh run view <run-id> --repo owner/repo
# 실패 로그
gh run view <run-id> --repo owner/repo --log-failed
# 재실행
gh run rerun <run-id> --repo owner/repo --failed-only
# 워크플로우 트리거
gh workflow run deploy.yml --repo owner/repo -f env=prod
```

## Releases

```bash
# 목록
gh release list --repo owner/repo
# 생성
gh release create v1.2.3 --repo owner/repo --title "v1.2.3" --notes "변경사항"
# 파일 업로드
gh release upload v1.2.3 dist/app.zip --repo owner/repo
# 삭제
gh release delete v1.2.3 --repo owner/repo --yes
```

## API 직접 호출

```bash
# REST API
gh api repos/owner/repo/pulls/55 --jq '.title, .state'
gh api repos/owner/repo/actions/runs --jq '.workflow_runs[0].status'

# GraphQL
gh api graphql -f query='
  query { viewer { login } }
'
```

## JSON 필터링 패턴

```bash
# 특정 필드만
gh pr list --json number,title --jq '.[] | "\(.number): \(.title)"'
# 조건 필터
gh issue list --json number,title,labels --jq '.[] | select(.labels[].name == "bug")'
```
