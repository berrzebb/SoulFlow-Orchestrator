# Skills System

Skills are extensions to agent capabilities. They live in `workspace/skills/` and provide specialized context and tools so agents perform more accurately in specific domains.

## Structure

Each skill has a two-layer layout.

```
workspace/skills/
  web-search/
    SKILL.md          ← Core description + routing conditions (~800B, always loaded)
    references/       ← Execution protocols, examples, detailed specs (loaded on demand)
  web-browsing/
    SKILL.md
  ppt-generator/
    SKILL.md
    references/
      ppt_style_guide.md
```

**Layer 1 (SKILL.md)**: Always included in agent context. Keep it short. Only role, trigger conditions, and core rules.
**Layer 2 (references/)**: Loaded by the agent when needed. Detailed specs, examples, checklists.

## Skill Types

| Type | Location | Characteristics |
|------|----------|-----------------|
| **builtin** | Source code | Role skills (butler · pm · pl · implementer · etc.) — read-only |
| **workspace** | `workspace/skills/` | User-defined skills — add/edit/delete from the dashboard |

All skills in `workspace/skills/` are custom skills managed directly by the user.

## Editing Skills from Dashboard

Edit skill files directly from **Workspace → Skills tab**.

1. Select a workspace skill from the list (builtin skills are not editable)
2. Choose a file tab (`SKILL.md` or a `references/` file)
3. Edit in the text editor
4. Click **Save** — changes take effect immediately (no restart needed)

> Builtin skills are embedded in source code and cannot be edited from the dashboard.

## Skill Management Commands

```
/skill list               → List available skills
/skill info <name>        → Skill details
/skill suggest            → Suggest skills for current request
/reload skills            → Hot reload skills without restart
```

## Creating a Custom Skill

1. Create `workspace/skills/<skill-name>/` directory
2. Write `SKILL.md`:

```markdown
# SKILL: <name>

## Role
One-line description of what this skill does.

## Trigger Conditions
When this skill should activate.

## Core Rules
- Rule 1
- Rule 2

## Tools
List of tools to use.
```

3. Apply immediately with `/reload skills` (no restart needed)

Or create/edit directly from **Dashboard → Workspace → Skills tab**.

## Related Docs

→ [Agent System](./agents.md)
→ [Dashboard Guide](../guide/dashboard.md)
→ [Slash Command Reference](../guide/slash-commands.md)
