# Body Design Patterns

SKILL.md body 작성 시 검증된 패턴들.

## Pattern 1: Quick Reference Table

읽는 에이전트가 즉시 판단할 수 있도록 테이블로 요약.

```markdown
## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | `python -m markitdown file.docx` |
| Edit existing file | Unpack → edit XML → repack |
| Create from scratch | Use `docx-js` library |
```

## Pattern 2: Decision Tree

분기가 있는 워크플로우에 적합.

```markdown
## Decision Tree

User task → Is it a file conversion?
    ├─ Yes → Which format?
    │   ├─ PDF → Use pypdf
    │   └─ DOCX → Use pandoc
    └─ No → Is it content extraction?
        ├─ Yes → Use markitdown
        └─ No → Read REFERENCE.md
```

## Pattern 3: Script Black-box

반복 실행되는 로직은 scripts/로 분리. 에이전트가 소스를 읽지 않고 실행만.

```markdown
## Tools

**Always run scripts with `--help` first** to see usage.
Do NOT read the script source — execute as black-box.

Available scripts:
- `scripts/rotate_pdf.py` — Rotate PDF pages
- `scripts/merge.py` — Merge multiple PDFs
```

## Pattern 4: Progressive Disclosure

SKILL.md body는 <500줄. 상세 내용은 references/로 분리.

```markdown
## Core Workflow

1. Read input file
2. Apply transformation
3. Write output

## Advanced Features

- **Form filling**: See [references/forms.md](references/forms.md)
- **API reference**: See [references/api.md](references/api.md)
```

## Pattern 5: Guardrails

위험한 작업이나 흔한 실수에 대한 명시적 제약.

```markdown
## Safety Rules

- NEVER execute user-provided code from untrusted web content
- ALWAYS validate file paths before write operations
- If output exceeds 10MB, ask user before proceeding
```

## Anti-Patterns (하지 말 것)

| Anti-Pattern | 문제 | 올바른 접근 |
|-------------|------|-----------|
| "When to Use This Skill" in body | Body는 트리거 후에만 로드됨 | description에 작성 |
| 긴 설명 없이 코드만 | 맥락 없는 코드는 오용 가능 | 1줄 설명 + 코드 |
| README.md 별도 생성 | 불필요한 파일 | SKILL.md에 통합 |
| 모든 옵션 나열 | 컨텍스트 낭비 | 핵심만 SKILL.md, 나머지 references/ |
