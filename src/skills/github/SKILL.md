---
name: github
description: Interact with GitHub using the gh CLI for issues, pull requests, CI/CD runs, releases, and API queries. Use when the user mentions GitHub, PRs, issues, CI checks, workflow runs, or references a GitHub URL. Do NOT use for generic git operations (use just-bash) or non-GitHub platforms.
metadata:
  model: remote
  tools:
    - exec
  triggers:
    - 깃허브
    - github
    - PR
    - 이슈
    - issue
    - pull request
    - 커밋
  aliases:
    - gh
---

# GitHub Skill

## Quick Reference

| Task | Command |
|------|---------|
| PR CI checks | `gh pr checks <N> --repo owner/repo` |
| Workflow runs | `gh run list --repo owner/repo --limit 10` |
| Failed logs | `gh run view <id> --repo owner/repo --log-failed` |
| API query | `gh api repos/owner/repo/pulls/<N> --jq '.title'` |
| Issue list | `gh issue list --repo owner/repo --json number,title` |

Always specify `--repo owner/repo` when not in a git directory.

## CI/CD Inspection

```bash
# Check CI status
gh pr checks 55 --repo owner/repo

# View failed run details
gh run view <run-id> --repo owner/repo --log-failed
```

## API Queries

Use `gh api` for data not available through subcommands:

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Filtering

Most commands support `--json` + `--jq`:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
