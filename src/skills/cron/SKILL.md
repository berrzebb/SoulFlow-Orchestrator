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
    - remind
    - schedule
  aliases:
    - 스케줄러
    - scheduler
---

# Cron

## Quick Reference

| Task | Tool Call |
|------|-----------|
| Add reminder | `cron(action="add", message="...", every_seconds=1200)` |
| Add cron job | `cron(action="add", message="...", cron_expr="0 9 * * 1-5", tz="...")` |
| One-time | `cron(action="add", message="...", at="<ISO datetime>")` |
| List all | `cron(action="list")` |
| Remove | `cron(action="remove", job_id="abc123")` |

## Three Modes

1. **Reminder** — message sent directly to user.
2. **Task** — agent executes message as a task and sends result.
3. **One-time** — runs once at specified time, then auto-deletes.

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
