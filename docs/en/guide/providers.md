# Provider Configuration

Manage agent backend instances from the dashboard → **Providers** page.

## What Is a Provider?

A provider is an LLM backend instance the agent uses. You can create multiple instances of the same provider type (e.g., `claude_sdk`) with different priorities.

## Adding a Provider

1. **Providers page** → click `Add`
2. Fill in the form:

| Field | Description | Example |
|-------|-------------|---------|
| Provider Type | Backend engine | `claude_sdk` |
| Instance ID | Unique identifier (auto-generated) | `claude_sdk` |
| Label | Display name | `Primary Claude` |
| Enabled | Whether active | ✓ |
| Priority | Higher = selected first (0–100) | `10` |
| API Token | API key for this backend | `sk-ant-...` |
| Supported Modes | Which execution modes to allow | `once`, `agent`, `task` |

3. Click `Add` to save

## Testing the Connection

Click the **Test** button on any provider card to verify the connection with a live API call.

- ✅ Pass — connected successfully
- ❌ Fail — check token or network

## Priority and Fallback

The instance with the highest priority is selected first. If that instance's CircuitBreaker is `open`, the next instance takes over automatically.

```
Priority 90: claude_sdk (open → blocked)
Priority 50: claude_cli (closed → selected)
Priority 10: openrouter (standby)
```

## CircuitBreaker States

| State | Display | Meaning |
|-------|---------|---------|
| `closed` | No badge | Normal |
| `half_open` | ⚠ Orange badge | Recovery in progress |
| `open` | ✗ Red badge | Blocked (auto-fallback active) |

`open` automatically transitions back through `half_open` over time.

## Supported Modes

| Mode | Description |
|------|-------------|
| `once` | Single-turn response |
| `agent` | Agent Loop (multi-turn tool execution) |
| `task` | Task Loop (stepwise long-running execution) |

Providers with a mode unchecked are excluded from that mode.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `Test` fails | Verify API token validity |
| Circuit breaker stuck `open` | Renew token, toggle Enable off and on |
| No response | Confirm a high-priority instance is enabled |

## Related Docs

→ [Agent System](../core-concepts/agents.md)
→ [Dashboard Guide](./dashboard.md)
