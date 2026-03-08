# Workflow Builder: Command Palette (NodePalette)

**Status**: ✅ Implemented

## Overview

Implemented a **[+ Tool / Skill]** button in the workflow builder toolbar that opens a searchable **Command Palette popover** for selecting and adding tools/skills with a single click.

### Goals
- Simplify tool/skill selection (2-step → 1-step UI)
- Enable search by name + description (fuzzy matching)
- Group by tool source (Built-in, Registered, MCP servers)
- Display MCP connection status
- Support keyboard navigation (↑↓ browse, Enter select, Esc close)
- Mobile-responsive design

## Architecture

### Component Structure

```
WorkflowBuilderPage
├── toolbar: [+ Tool / Skill] button
├── NodePalette (paletteOpen && toolsData)
│   ├── search input
│   ├── group list
│   │   ├── Built-in (native tools)
│   │   ├── Registered (other tools)
│   │   ├── MCP: {server} (server tools + connection status)
│   │   └── Skills
│   └── items (hoverable, keyboard navigable)
└── onSelectTool / onSelectSkill callbacks
    ├── append to tool_nodes / skill_nodes
    ├── set attach_to first phase
    └── auto-select in inspector
```

### Data Flow

1. **Query**: `/api/tools` → `toolsData` (names, definitions, mcp_servers)
2. **Query**: `/api/skills` → `skillsData` (SkillListItem[])
3. **Filter**: by query on name/description
4. **Categorize**: via build_items() into native/registered/mcp
5. **Render**: PaletteItem[] → UI
6. **Select**: onSelectTool/onSelectSkill → append to workflow

## Type Design

### McpServer (node-palette.tsx)
```typescript
interface McpServer {
  name: string;
  connected?: boolean;  // optional (API response may omit)
  tools: string[];
  error?: string;
}
```

### ToolsData (node-palette.tsx)
```typescript
export interface ToolsData {
  names: string[];                        // all tool names (unique)
  definitions: Array<Record<string, unknown>>;  // OpenAPI defs
  mcp_servers: McpServer[];              // MCP server list
  native_tools?: string[];               // Built-in tool names
}
```

### PaletteItem (internal)
```typescript
interface PaletteItem {
  kind: "tool" | "skill";
  id: string;
  description: string;
  group: string;
}
```

### NodePaletteProps
```typescript
interface NodePaletteProps {
  tools: ToolsData;
  skills: SkillItem[];
  onSelectTool: (tool_id: string, description: string) => void;
  onSelectSkill: (skill_name: string, description: string) => void;
  onClose: () => void;
}
```

## Affected Files

| File | Change |
|------|--------|
| `web/src/components/node-palette.tsx` | Make McpServer.connected optional |
| `web/src/pages/workflows/builder.tsx` | NodePalette import, state, toolbar button, callbacks |
| `web/src/styles/layout.css` | Add .node-palette* classes (~170 lines) |
| `src/i18n/locales/en.json` | Add palette.open_tools_skills key |
| `src/i18n/locales/ko.json` | Add palette.open_tools_skills key |

## CSS Classes

### Popover Structure
```css
.node-palette__backdrop     /* transparent overlay */
.node-palette              /* popover container */
├── .node-palette__search  /* search input section */
├── .node-palette__list    /* item list (scrollable) */
│   └── .node-palette__group          /* group section */
│       ├── .node-palette__group-header  /* group header (toggleable) */
│       │   ├── .node-palette__group-arrow
│       │   ├── .node-palette__group-name
│       │   ├── .node-palette__group-count
│       │   └── .node-palette__status  /* MCP connection badge */
│       └── .node-palette__item       /* item */
│           ├── .node-palette__item-icon
│           ├── .node-palette__item-name
│           └── .node-palette__item-desc
└── .node-palette__empty  /* no results state */
```

### Colors & States
- `.node-palette__status--ok`: var(--ok) — MCP connected
- `.node-palette__status--err`: var(--err) — MCP disconnected
- `.node-palette__item--active`: keyboard focus or mouse hover
- `.node-palette__item-desc`: text-overflow ellipsis

## Keyboard Interactions

| Key | Action |
|-----|--------|
| ↑/↓ | navigate items (cursor moves) |
| Enter | select current item (trigger callback) |
| Esc | close popover |
| Click | select item or toggle group |

## State Management (builder.tsx)

```typescript
const [paletteOpen, setPaletteOpen] = useState(false);
const paletteBtnRef = useRef<HTMLButtonElement>(null);

// Tool selection
const handleSelectTool = (tool_id: string, description: string) => {
  const newNode: ToolNodeDef = {
    id: `tool-${idx}`,
    tool_id,
    description,
    attach_to: [firstPhaseId],
  };
  setWorkflow({ ...workflow, tool_nodes: [...old, newNode] });
  setPaletteOpen(false);
  setInspectorNodeId(`${firstPhaseId}__tool_${newNode.id}`);
};
```

## Usage Example

### Button Click Flow
1. User clicks "[+ Tool / Skill]"
2. `paletteOpen = true` → NodePalette renders
3. User types search query (e.g., "http")
4. Filtered items shown (http_request, http_proxy, etc.)
5. User clicks item or presses Enter → onSelectTool called
6. New node appended to tool_nodes
7. Auto-selected in inspector for editing
8. Popover closes

### Group Structure
```
┌─────────────────────────────────────┐
│ 🔍 Search tools & skills...         │
├─────────────────────────────────────┤
│ ▾ Built-in (5)                      │
│   🔧 shell_execute — Run shell...   │
│   🔧 http_request — HTTP call...    │
│ ▾ MCP: slack (3)             🟢     │
│   🔧 slack_post_message             │
│   🔧 slack_list_channels            │
│ ▾ MCP: github (2)             🔴   │
│   ⚡ github_search_code             │
│ ▾ Skills (2)                        │
│   ⚡ deploy — Deploy service        │
│   ⚡ hwpx — HWPX document build     │
└─────────────────────────────────────┘
```

## Mobile Considerations

- Popover width: 90vw (max 100%)
- Height: max 70vh (screen height)
- Touch target minimum 44px
- Search input always visible

## Performance Optimizations

1. **Query Caching**: tools/skills cached with 60s stale time
2. **Memoization**: build_items() runs per-render on already-cached data
3. **Keyboard Navigation**: stopPropagation on mouse events
4. **Deferred Inspector Selection**: setTimeout ensures render order

## Compatibility

- **NodePicker**: Side panel in graph editor (unchanged)
- **AddHandle**: Mid-edge node insertion (unchanged)
- **Cron/Channel buttons**: Separate modals (unchanged)

## Test Scenarios

1. ✅ "[+ Tool / Skill]" click → popover opens
2. ✅ Type search query → real-time filtering
3. ✅ MCP servers grouped + connection badges shown
4. ✅ Tool click → tool_node added (description pre-filled)
5. ✅ Skill click → skill_node added
6. ✅ Keyboard (↑↓ Enter) navigation works
7. ✅ Esc or backdrop click → popover closes
8. ✅ Added node auto-selected in inspector

## Future Improvements

- [ ] Pin frequently-used tools/skills
- [ ] Favorites feature
- [ ] Parameter hints per tool
- [ ] Drag & drop to canvas
- [ ] Macro / template nodes
