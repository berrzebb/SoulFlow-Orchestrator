# Slash Command Reference

Control commands you can type directly in any chat channel.

## General

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/status` | Runtime status · tools · skills summary |
| `/stats` | Runtime statistics (CD score · session metrics) |
| `/doctor` | Self-diagnose service health |
| `/stop` · `/cancel` | Stop active task in current channel immediately |
| `/verify` | Validate last output |

## Rendering

| Command | Description |
|---------|-------------|
| `/render status` | Show current render mode |
| `/render markdown` · `html` · `plain` | Change render mode |
| `/render reset` | Reset to default |
| `/render link indicator\|text\|remove` | How to represent blocked links |
| `/render image indicator\|text\|remove` | How to represent blocked images |

## Security Vault

| Command | Description |
|---------|-------------|
| `/secret status` | Vault status |
| `/secret list` | List stored keys |
| `/secret set <key> <value>` | Encrypt and store |
| `/secret get <key>` | Get reference value |
| `/secret reveal <key>` | Show actual value |
| `/secret remove <key>` | Delete |
| `/secret encrypt <text>` | One-off encryption |
| `/secret decrypt <cipher>` | One-off decryption |

## Memory

| Command | Description |
|---------|-------------|
| `/memory status` | Memory status summary |
| `/memory list` | Daily memory index |
| `/memory today` | Today's memory content |
| `/memory longterm` | Full long-term memory |
| `/memory search <q>` | Keyword search |

## Tasks

| Command | Description |
|---------|-------------|
| `/task list` | List running tasks |
| `/task cancel <id>` | Cancel a task |

## Agents

| Command | Description |
|---------|-------------|
| `/agent list` | List sub-agents |
| `/agent cancel <id>` | Cancel a sub-agent |
| `/agent send <id> <message>` | Send message to sub-agent |

## Skills

| Command | Description |
|---------|-------------|
| `/skill list` | List available skills |
| `/skill info <name>` | Skill details |
| `/skill suggest` | Recommend skill for current request |

## Decisions

| Command | Description |
|---------|-------------|
| `/decision status` | Decision system status |
| `/decision list` | List stored decisions |
| `/decision set <key> <value>` | Store a decision |

## Promises / Deferred Execution

| Command | Description |
|---------|-------------|
| `/promise status` | Promise status |
| `/promise list` | List pending promises |
| `/promise resolve <id> <value>` | Resolve a promise |

## Cron

| Command | Description |
|---------|-------------|
| `/cron status` | Cron schedule status |
| `/cron list` | List registered jobs |
| `/cron add <expr> <command>` | Register a job |
| `/cron remove <id>` | Delete a job |

## Confirmation Guard

| Command | Description |
|---------|-------------|
| `/guard` | Show guard status (enabled/disabled, pending count) |
| `/guard on` | Enable confirmation guard — prompts for confirmation before cron and long-running operations |
| `/guard off` | Disable confirmation guard |

## Workflows

| Command | Description |
|---------|-------------|
| `/workflow list` | List active workflows |
| `/workflow create` | Create a new workflow |
| `/workflow cancel <id>` | Cancel a running workflow |

## Models

| Command | Description |
|---------|-------------|
| `/model list` | List installed orchestrator LLM models |
| `/model set <name>` | Switch the active classifier model |

## MCP

| Command | Description |
|---------|-------------|
| `/mcp list` | List connected MCP servers and status |
| `/mcp reconnect <name>` | Reconnect a specific MCP server |

## Tone

| Command | Description |
|---------|-------------|
| `/tone <style>` | Set persona tone (e.g., `formal`, `casual`, `warm`, `cool`, `short`, `detailed`) |
| `/tone status` | Show current tone settings |
| `/tone reset` | Reset to default tone |

## Hot Reload

| Command | Description |
|---------|-------------|
| `/reload config` | Reload configuration |
| `/reload tools` | Reload tools |
| `/reload skills` | Reload skills |
