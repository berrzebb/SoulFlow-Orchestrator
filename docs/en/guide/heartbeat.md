# Heartbeat (Periodic Execution)

HeartbeatService reads `workspace/HEARTBEAT.md` at each interval and delegates execution to the agent if the file contains tasks.

## How It Works

```
Timer tick
  → Read HEARTBEAT.md
  → File is empty → skip
  → File has content → run agent ("read HEARTBEAT.md and follow instructions")
  → Agent returns HEARTBEAT_OK → no notification
  → Any other result → report to channel
```

## Enable / Disable

Controlled entirely by the content of `workspace/HEARTBEAT.md`.

**Disabled (default)**: Only comments, `#` headings, or `- [ ]` checkboxes → no execution.

```markdown
# HEARTBEAT
<!-- empty = disabled -->
```

**Enabled**: Add actual task content (not comments).

```markdown
# HEARTBEAT

Notify #alerts if disk usage exceeds 80%.
```

## Writing Effective Tasks

Specific, condition-based instructions work best.

```markdown
# HEARTBEAT

## System Monitoring
- If disk usage > 80%, send alert to Slack #alerts immediately
- If memory usage > 90%, send alert immediately

## Daily Report (Morning)
Summarize today's scheduled tasks and send to Telegram.
Trigger condition: first heartbeat run after 09:00 KST

## Service Check
Run /doctor and report any issues found.
```

## Common Patterns

### Conditional Alert

```
If [metric] of [service] exceeds [threshold], send [format] to [channel].
```

### Periodic Report

```
At [time condition], send [content] to [target channel].
Example: "On first run of the day, send yesterday's task summary to Slack"
```

### Status Check

```
Run [command/service] and if [condition], take [action].
```

## Editing in Dashboard

Dashboard → **Templates** page → `HEARTBEAT` item.
Edits are saved to `workspace/templates/HEARTBEAT.md` (reference template).
The **actual runtime file** is `workspace/HEARTBEAT.md`.

## Interval Configuration

Adjust the interval from the dashboard → **Settings** by changing `heartbeat.interval_s` (default: 300 seconds).

## Related Docs

→ [Slash Command Reference](./slash-commands.md)
→ [Dashboard Guide](./dashboard.md)
