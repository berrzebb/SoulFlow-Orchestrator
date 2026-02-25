# Builtin Skills

This directory contains built-in skills for the headless orchestrator runtime.

## Skill Format

Each skill is a directory containing a `SKILL.md` file with:
- YAML frontmatter (name, description, metadata)
- Markdown instructions for the agent

## Attribution

These skills are adapted from [OpenClaw](https://github.com/openclaw/openclaw)'s skill system.
The skill format and metadata structure follow OpenClaw's conventions to maintain compatibility.

## Available Skills

| Skill | Description |
|-------|-------------|
| `github` | Interact with GitHub using the `gh` CLI |
| `weather` | Get weather info using wttr.in and Open-Meteo |
| `summarize` | Summarize URLs, files, and YouTube videos |
| `tmux` | Remote-control tmux sessions |
| `clawhub` | Search and install skills from ClawHub registry |
| `skill-creator` | Create new skills |
| `agent-browser` | Browser automation and web research using web_search/web_fetch/web_browser |
| `just-bash` | Efficient shell workflow through exec with automatic just-bash runtime |
| `python-sandbox` | Temporary podman/docker Python execution with in-container virtual environment |
| `temp-db` | Ephemeral DB workflow (default PostgreSQL) with container start/query/cleanup |
| `diagram` | Mermaid diagram rendering using builtin diagram_render tool (@vercel/beautiful-mermaid) |
