---
name: summarize
description: Summarize or extract text from URLs, local files, YouTube videos, and podcasts using the summarize CLI. Use when the user asks to summarize a link, article, video, or document. Supports multiple output lengths and models. Do NOT use for web search (use web-search) or for content the agent can read directly.
metadata:
  model: remote
  tools:
    - exec
  triggers:
    - 요약
    - 정리
    - summarize
    - 요약해줘
    - 정리해줘
  aliases:
    - 요약
  homepage: https://summarize.sh
---

# Summarize

## Quick Reference

| Input | Command |
|-------|---------|
| URL/article | `summarize “https://...” --model openai/gpt-4.1-mini` |
| Local file | `summarize “/path/to/file.pdf”` |
| YouTube | `summarize “https://youtu.be/...” --youtube auto` |
| Extract only | `summarize “URL” --extract-only` |

## Quick start

```bash
summarize "https://example.com" --model openai/gpt-4.1-mini
summarize "/path/to/file.pdf" --model anthropic/claude-3-5-sonnet
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto
```

## YouTube: summary vs transcript

Best-effort transcript (URLs only):

```bash
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto --extract-only
```

If the user asked for a transcript but it’s huge, return a tight summary first, then ask which section/time range to expand.

## Model + keys

Set the API key for your chosen provider:
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`

Default model is `openai/gpt-4.1-mini` if none is set.

## Useful flags

- `--length short|medium|long|xl|xxl|<chars>`
- `--max-output-tokens <count>`
- `--extract-only` (URLs only)
- `--json` (machine readable)
- `--youtube auto`

## Config

Optional config file: `~/.summarize/config.json`

```json
{ "model": "openai/gpt-5.2" }
```

Optional services:
- Additional provider-specific options can be configured in summarize CLI docs.
