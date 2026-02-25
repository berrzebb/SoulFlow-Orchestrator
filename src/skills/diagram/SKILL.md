---
name: diagram
description: Generate Mermaid diagrams with the builtin diagram_render tool (@vercel/beautiful-mermaid).
---

# Diagram

Use this skill when the user asks for architecture diagrams, flowcharts, sequence diagrams, ERD, class diagrams, or ASCII diagrams.

## Primary Tool

- `diagram_render` (builtin)

No external CLI is required. The renderer is embedded in the orchestrator runtime.

## Workflow

1. Draft Mermaid source from user intent.
2. Render with `diagram_render`.
3. If SVG is requested, save output to a `.svg` file via `write_file`.
4. If terminal-friendly output is requested, render `format=ascii`.

## Tool Calls

List themes:

```text
diagram_render(action="list_themes")
```

Render SVG (default):

```text
diagram_render(
  action="render",
  format="svg",
  theme="vercel-dark",
  animate=true,
  diagram="graph TD; A[Start] --> B{Check}; B -->|OK| C[Done]; B -->|Fail| D[Retry]"
)
```

Render ASCII:

```text
diagram_render(
  action="render",
  format="ascii",
  use_ascii=false,
  diagram="sequenceDiagram; Alice->>Bob: Hello; Bob-->>Alice: Hi"
)
```

## Quality Rules

- Keep node labels short and explicit.
- Prefer deterministic layout directions (`TD`, `LR`) to reduce redraw churn.
- For large diagrams, split into multiple focused diagrams.

