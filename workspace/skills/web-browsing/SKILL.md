---
name: web-browsing
description: Execute web research with up-to-date sources, citations, and clear verification steps. Use when users ask to search the internet, verify latest facts, compare current options, or provide source-linked summaries.
---

# Web Browsing Skill

Execute these steps for every web-research task.

## 1) Define Scope Fast

- Restate the target in one sentence.
- Extract constraints: date range, region, source type, budget, and output format.
- Ask a clarification question only when ambiguity blocks accurate execution.

## 2) Build Search Plan

- Create 2 to 4 precise queries instead of one broad query.
- Prefer primary sources first: official docs, standards, government pages, vendor pages, original papers.
- Add at least one independent secondary source for cross-checking.

## 3) Gather and Verify

- Open the top relevant results and scan for publication/update dates.
- For time-sensitive claims, confirm with at least two reliable sources.
- If sources conflict, report the conflict directly and state which source is more authoritative.
- Avoid copying large quotes; summarize and keep quotes minimal.

## 4) Synthesize for the User

- Lead with the direct answer first.
- Separate confirmed facts from inference.
- Include concrete dates (for example: "February 23, 2026") for any "latest/current" claim.
- Add a short "What changed recently" note when relevant.

## 5) Cite Clearly

- Provide source links for each major claim.
- Prefer one link per claim cluster instead of link dumping.
- If evidence is insufficient, say what was found and why it is insufficient.

## Output Template

Use this structure when the user asks for a report:

```markdown
Summary
- <direct answer>

Key Findings
- <finding 1 with date>
- <finding 2 with date>

Uncertainties
- <conflict, gap, or assumption>

Sources
- <title> - <url>
- <title> - <url>
```
