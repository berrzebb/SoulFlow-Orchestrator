---
name: diagram
description: Generate Mermaid diagrams (flowcharts, sequence, ERD, class, state, gantt, pie, mindmap) as SVG or ASCII using the builtin diagram_render tool. Use when the user asks for architecture diagrams, visual charts, or mentions Mermaid syntax. Do NOT use for image generation, screenshots, or non-diagram visuals.
metadata:
  model: local
  tools:
    - diagram_render
  triggers:
    - 다이어그램
    - 도표
    - 플로우차트
    - 시퀀스
    - mermaid
    - diagram
    - chart
  aliases:
    - 차트
---

# Diagram

## Quick Reference

| Task | Tool Call |
|------|-----------|
| SVG flowchart | `diagram_render(action="render", format="svg", diagram="graph TD; A-->B")` |
| ASCII diagram | `diagram_render(action="render", format="ascii", diagram="...")` |
| Themed SVG | `diagram_render(action="render", format="svg", theme="vercel-dark", animate=true, diagram="...")` |
| List themes | `diagram_render(action="list_themes")` |

No external CLI required — renderer is embedded in the orchestrator runtime.

## Supported Diagram Types

flowchart, sequence, ERD, class, state, gantt, pie, mindmap (all standard Mermaid syntax).

## Workflow

1. Draft Mermaid source from user intent.
2. Render with `diagram_render`.
3. SVG output → save to `.svg` via `write_file`. Terminal output → use `format=ascii`.

## Guardrails

- Keep node labels short and explicit.
- Use deterministic layout directions (`TD`, `LR`) to reduce redraw churn.
- Large diagrams → split into multiple focused diagrams.

