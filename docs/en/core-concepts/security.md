# Security Vault

SoulFlow manages sensitive data through an AES-256-GCM encrypted Vault. API keys, tokens, and passwords are stored securely — agents only receive references, never plaintext.

## Core Principles

- **Agents never see plaintext** — only `{{secret:KEY_NAME}}` references pass into agent context
- **Decryption at tool execution** — real values are used only when a tool runs
- **Inbound auto-Sealing** — messages containing token/password patterns are automatically detected and stored in the Vault

## Basic Usage

```
/secret set MY_API_KEY sk-abc123          → encrypt and store
/secret get MY_API_KEY                    → get reference value (not plaintext)
/secret reveal MY_API_KEY                 → see actual value (user only)
/secret list                              → list stored keys
/secret remove MY_API_KEY                 → delete
/secret status                            → Vault status
```

## One-Off Encryption

Encrypt or decrypt without storing:

```
/secret encrypt <plaintext>    → returns encrypted value
/secret decrypt <ciphertext>   → returns decrypted value
```

## Inbound Auto-Sealing

When a user includes sensitive data directly in a message, it's handled automatically.

```
User: Call the API using MY_API_KEY (sk-abc123)
  → SoulFlow detects sk-abc123
  → Saves to Vault and replaces with a reference
  → Agent only sees {{secret:detected_1}}
```

## Referencing Secrets in Agents

```
User: Use OPENAI_KEY in the header for the API call
  → Agent automatically decrypts from Vault when executing the tool
  → No plaintext appears in agent responses or logs
```

## Important Notes

- Back up the Vault file (`runtime/vault/vault.db`)
- Lost Vault key = lost secrets (no recovery)
- `/secret reveal` only runs on explicit user request

## Related Docs

→ [Memory System](./memory.md)
→ [Slash Command Reference](../guide/slash-commands.md)
