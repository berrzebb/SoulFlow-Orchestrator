---
name: cron
description: Schedule reminders, recurring tasks, and one-time notifications using the cron tool. Use when the user asks to set a reminder, schedule a recurring task, create a timer, or wants periodic execution. Also use for listing or removing existing schedules. Do NOT use for immediate one-off actions that need no scheduling.
metadata:
  model: local
  tools:
    - cron
  triggers:
    - 알림
    - 리마인더
    - 예약
    - 스케줄
    - 반복
    - 매일
    - 매주
    - 오전
    - 오후
    - 시에
    - 아침
    - 저녁
    - 자정
    - 정오
    - 뒤에
    - 후에
    - 분 후
    - 시간 후
    - remind
    - schedule
    - at
    - every
    - timer
  aliases:
    - 스케줄러
    - scheduler
---

# Cron

## Quick Reference

| Task | Tool Call |
|------|-----------|
| Add task (실행) | `cron(action="add", message="Hikari를 재생해줘", at="<ISO>")` |
| Add reminder (알림) | `cron(action="add", message="회의 시간입니다", at="<ISO>", deliver=true)` |
| Recurring task | `cron(action="add", message="...", cron_expr="0 9 * * 1-5", tz="...")` |
| List all | `cron(action="list")` |
| Remove | `cron(action="remove", job_id="abc123")` |

## deliver Parameter (중요)

| deliver | 동작 | 사용 시점 |
|---------|------|-----------|
| `true` | 메시지만 채널에 전달 (알림/리마인더) | "알려줘", "리마인드", "알림" |
| `false` (기본값) | 에이전트가 메시지를 **작업으로 실행** | "재생해줘", "실행해줘", "검색해줘", "보내줘" |

**행동이 필요한 요청은 반드시 `deliver: false`** (또는 생략). `deliver: true`는 단순 텍스트 알림에만 사용.

## Time Expression Mapping

| User says | Parameters |
|-----------|------------|
| every 20 minutes | `every_seconds: 1200` |
| every hour | `every_seconds: 3600` |
| every day at 8am | `cron_expr: "0 8 * * *"` |
| weekdays at 5pm | `cron_expr: "0 17 * * 1-5"` |
| 9am Vancouver time | `cron_expr: "0 9 * * *", tz: "America/Vancouver"` |
| at a specific time | `at: "<ISO datetime>"` (compute from current time) |

## Timezone

Use `tz` with `cron_expr` for IANA timezone scheduling. Without `tz`, server local timezone is used.

## References

- **[cron-expressions.md](references/cron-expressions.md)** — cron 표현식 패턴, every_seconds 값, 주요 타임존, 자연어→cron 변환표
