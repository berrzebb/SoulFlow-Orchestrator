# Security

SoulFlow implements defense-in-depth across the entire message lifecycle — from inbound ingestion through agent execution to outbound delivery.

## Architecture Overview

```
Inbound                    Execution                  Outbound
─────────────────────     ──────────────────────     ─────────────────────
Media security checks     Approval gates (HITL)      Output sanitizer
Sensitive auto-sealing    Tool-level secret inject   Secret reference masking
Private host blocking     Sandbox policy             Outbound deduplication
                          Subagent isolation         DLQ (failure recovery)
                                                     Session recording
```

---

## 1. Secret Vault

Sensitive data is stored with AES-256-GCM authenticated encryption. Agents never see plaintext — only `{{secret:KEY_NAME}}` references.

### How It Works

1. **Encryption**: Each secret gets a unique 12-byte IV and 16-byte auth tag
2. **Token format**: `sv1.{iv}.{tag}.{ciphertext}` (base64url-encoded)
3. **AAD binding**: Secret name is bound as Additional Authenticated Data — tampering is detected
4. **Master key**: 32 random bytes, stored in SQLite (`runtime/security/secrets.db`)

### Commands

```
/secret set MY_KEY sk-abc123     → encrypt and store
/secret get MY_KEY               → get reference (not plaintext)
/secret reveal MY_KEY            → see actual value (user only)
/secret list                     → list stored keys
/secret remove MY_KEY            → delete
/secret status                   → Vault status
/secret encrypt <text>           → one-off encrypt (no storage)
/secret decrypt <cipher>         → one-off decrypt
```

### Placeholder Resolution

During tool execution, `{{secret:NAME}}` references are resolved to plaintext just-in-time. The resolution pipeline:

1. `resolve_placeholders()` — replaces `{{secret:*}}` tokens
2. `resolve_inline_secrets()` — also decrypts bare `sv1.*` tokens
3. `resolve_placeholders_with_report()` — returns missing keys and invalid ciphertexts for audit

### Maintenance

- Auto-generated secrets (`inbound.*` prefix) are pruned by TTL
- Back up `runtime/security/secrets.db` — lost key = lost secrets

---

## 2. Inbound Auto-Sealing

Messages containing token/password patterns are detected and sealed automatically before reaching the agent.

```
User: Use this key sk-abc123 for the API call
  → SoulFlow detects sk-abc123
  → Encrypts and stores in Vault
  → Agent sees {{secret:detected_1}} instead
```

Detected patterns include: OpenAI (`sk-`), Anthropic (`sk-ant-`), GitHub PATs (`ghp_`, `ghs_`), AWS keys (`AKIA`, `ASIA`), Slack tokens (`xox[baprs]-`), Stripe keys, JWTs (`eyJ...`), private keys, database URIs, and more.

---

## 3. Sensitive Data Redaction

A separate layer from the Vault — scans all text for credential patterns and replaces them with `[REDACTED]`.

### Pattern-Based Detection

Pre-compiled regexes match:
- Private keys (`-----BEGIN ... PRIVATE KEY-----`)
- JWTs, API keys (OpenAI, Anthropic, GitHub, AWS, Stripe, Twilio, SendGrid, Telegram, Google, Azure)
- Database connection strings (MongoDB, PostgreSQL)

### Environment-Based Masking

At startup, scans `process.env` for keys containing `token`, `api_key`, `secret`, `password`, `access_key`, `refresh_token`. Any exact value match in output is masked.

### Assignment Detection

Lines like `API_KEY=sk-abc123` or `token: ghp_xxx` are detected and the value portion is redacted.

---

## 4. Output Sanitizer

Three-level sanitization strips leaked internal state, protocols, and credentials from agent output.

### Level 1: Final Output (`sanitize_provider_output`)

Removes:
- Internal tool marshalling blocks (`<ORCH_TOOL_CALLS>`)
- Persona/identity leaks (AGENTS.md, SOUL.md, HEART.md content)
- Shell script blocks
- Provider noise (execution mode labels, reconnection messages)
- Tool protocol fragments (`"tool_calls":`, `"id":"call_*"`)

### Level 2: Streaming (`sanitize_stream_chunk`)

More aggressive — additionally filters:
- Sensitive shell commands (cd, grep, npm, cargo, etc.)
- Empty lines and whitespace noise
- Agent self-introductions and @mentions

### Level 3: Secret Masking

- `{{secret:*}}` tokens → `[SECRET]`
- `sv1.*` ciphertext → `[ENCRYPTED]`
- ANSI terminal color codes stripped
- HTML tags sanitized (`<script>`, `<iframe>` removed; `<code>`, `<a>` converted to text)

---

## 5. Approval Workflow (HITL)

Dangerous or sensitive tool executions require explicit user approval before proceeding.

### Flow

```
Agent requests tool execution
  → Tool flagged as gated
  → Approval request sent to user (with tool name, params, context)
  → User responds (text or reaction)
  → Decision parsed → approve / deny / defer / cancel / clarify
  → If approved: tool executes and result feeds back into agent context
```

### Response Methods

| Method | Examples |
|--------|----------|
| Text | `y`, `yes`, `ok`, `승인`, `허용` (approve) / `n`, `no`, `거절` (deny) |
| Reaction | ✅👍 (approve) / ❌👎 (deny) / ⏸️⏳ (defer) |

### Confidence Scoring

Responses are scored by regex match count. The margin between top and second-place decisions determines confidence (0.1–1.0). Ambiguous responses are flagged as `unknown`.

### Deduplication

Reaction-based approvals use signature-based dedup with TTL pruning to prevent double-processing.

---

## 6. Media Security

Files downloaded from messages go through multiple security checks.

| Check | Rule |
|-------|------|
| Private host blocking | Rejects localhost, 10.x, 172.16–31.x, 192.168.x, 169.254.x, IPv6 loopback |
| Size limit | Max 20 MB per remote file |
| Fetch timeout | 15-second abort |
| Extension whitelist | 36 allowed extensions (images, documents, archives, media) |
| Filename sanitization | Strips shell metacharacters, max 120 chars |
| Per-message limit | Max 8 files per message |
| Auth isolation | Slack (Bearer token), Telegram (bot API), Discord (public) — each channel's auth is scoped |

Storage: `workspace/runtime/inbound-files/{provider}/{timestamp}-{filename}`

---

## 7. Operational Safety

### Outbound Deduplication

Prevents duplicate message delivery across retries. Agent replies are keyed by `[instance_id, chat_id, thread_id, reply_to, trigger_message_id]` — ensuring single-emission per triggering message.

### Dead Letter Queue

Failed deliveries are stored in SQLite (`runtime/dlq/dlq.db`) with:
- Retry count, error details, full message content
- Time-based pruning
- Recovery capability for channel-specific replay

### Session Recording

Dual-layer recording for audit and memory:
- **SQLite**: Structured per-chat session with metadata (sender, timestamps, tool call counts, usage)
- **Daily log**: Plaintext append in `[ISO_TIMESTAMP] [provider:chat_id:thread] ROLE(sender): text` format

### Dispatch Retry

- Token bucket rate limiter
- Exponential backoff (base × 2^attempt, capped)
- Non-retryable errors bypass retry: `invalid_auth`, `channel_not_found`, `permission_denied`

---

## Related Docs

→ [Agents](./agents.md)
→ [Slash Command Reference](../guide/slash-commands.md)
→ [Memory System](./memory.md)
