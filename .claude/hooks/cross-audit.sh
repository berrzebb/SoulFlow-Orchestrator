#!/bin/bash
# PostToolUse hook: docs/feedback/claude.md 수정 시 교차 감사 자동 실행.
#
# Claude → GPT (codex audit): feedback-audit.mjs
# GPT → Claude (status + next-task sync): feedback-audit.mjs 내부에서 처리
#
# 무한 루프 방지: FEEDBACK_LOOP_ACTIVE 환경변수로 가드.

# 재귀 방지
if [ "$FEEDBACK_LOOP_ACTIVE" = "1" ]; then
  exit 0
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# claude.md 수정이 아니면 무시
if [[ ! "$FILE_PATH" =~ docs/feedback/[Cc][Ll][Aa][Uu][Dd][Ee]\.[Mm][Dd]$ ]]; then
  exit 0
fi

# [GPT미검증] 항목이 없으면 감사 불필요
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ]; then
  CWD="d:/claude-tools/.claude/mcp-servers/slack/next"
fi

if ! grep -q '\[GPT미검증\]' "$CWD/docs/feedback/claude.md" 2>/dev/null; then
  exit 0
fi

# 백그라운드 단일 진입점: codex 감사 → 상태/다음 작업 동기화
(
  cd "$CWD"
  export FEEDBACK_LOOP_ACTIVE=1
  node scripts/feedback-audit.mjs 2>&1 | head -20
) &

exit 0
