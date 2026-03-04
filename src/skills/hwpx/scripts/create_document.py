#!/usr/bin/env python3
"""Create an HWPX document from Markdown or JSON input.

Supports:
  - Paragraphs (plain text lines)
  - Tables (Markdown pipe tables or JSON array-of-arrays)
  - Headers/footers (via JSON metadata)

Usage:
    python create_document.py --input content.md --output result.hwpx
    python create_document.py --input content.json --output result.hwpx
    echo "Hello World" | python create_document.py --output result.hwpx
"""

import argparse
import json
import re
import sys
from pathlib import Path

from hwpx import HwpxDocument


def parse_markdown(text: str) -> list[dict]:
    """Parse Markdown text into a list of content blocks.

    Returns a list of dicts, each with:
      - {"type": "paragraph", "text": "..."}
      - {"type": "table", "rows": [["cell", ...], ...]}
      - {"type": "heading", "level": 1-6, "text": "..."}
    """
    blocks: list[dict] = []
    lines = text.split("\n")
    table_buffer: list[str] = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Heading
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            if table_buffer:
                blocks.append(_parse_md_table(table_buffer))
                table_buffer = []
            level = len(heading_match.group(1))
            blocks.append({
                "type": "heading",
                "level": level,
                "text": heading_match.group(2).strip(),
            })
            i += 1
            continue

        # Table row (pipe-delimited)
        if "|" in line and line.strip().startswith("|"):
            table_buffer.append(line)
            i += 1
            continue

        # End of table
        if table_buffer:
            blocks.append(_parse_md_table(table_buffer))
            table_buffer = []

        # Non-empty line -> paragraph
        stripped = line.strip()
        if stripped:
            blocks.append({"type": "paragraph", "text": stripped})

        i += 1

    if table_buffer:
        blocks.append(_parse_md_table(table_buffer))

    return blocks


def _parse_md_table(lines: list[str]) -> dict:
    """Parse Markdown pipe table lines into a table block."""
    rows = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Skip separator rows (e.g., |---|---|---|)
        if re.match(r"^\|[\s\-:|]+$", line):
            continue
        cells = [c.strip() for c in line.split("|")]
        # Remove empty first/last from leading/trailing pipes
        if cells and cells[0] == "":
            cells = cells[1:]
        if cells and cells[-1] == "":
            cells = cells[:-1]
        if cells:
            rows.append(cells)
    return {"type": "table", "rows": rows}


def parse_json_input(text: str) -> list[dict]:
    """Parse JSON input into content blocks.

    Expected format:
    {
      "header": "optional header text",
      "footer": "optional footer text",
      "content": [
        {"type": "paragraph", "text": "..."},
        {"type": "heading", "level": 1, "text": "..."},
        {"type": "table", "rows": [["a", "b"], ["c", "d"]]}
      ]
    }
    """
    data = json.loads(text)
    blocks: list[dict] = []

    if "header" in data:
        blocks.append({"type": "header", "text": data["header"]})
    if "footer" in data:
        blocks.append({"type": "footer", "text": data["footer"]})

    content = data.get("content", [])
    if isinstance(content, list):
        blocks.extend(content)

    return blocks


def create_document(blocks: list[dict], output_path: str) -> None:
    """Create an HWPX document from parsed content blocks."""

    doc = HwpxDocument.new()
    section = doc.sections[0]

    for block in blocks:
        btype = block.get("type", "paragraph")

        if btype == "paragraph":
            doc.add_paragraph(block.get("text", ""), section=section)

        elif btype == "heading":
            text = block.get("text", "")
            doc.add_paragraph(text, section=section)

        elif btype == "table":
            rows = block.get("rows", [])
            if not rows:
                continue
            num_rows = len(rows)
            num_cols = max(len(r) for r in rows) if rows else 1
            table = doc.add_table(num_rows, num_cols, section=section)
            for r_idx, row in enumerate(rows):
                for c_idx, cell_text in enumerate(row):
                    if c_idx < num_cols:
                        table.set_cell_text(r_idx, c_idx, str(cell_text))

        elif btype == "header":
            try:
                doc.set_header_text(block.get("text", ""), section=section)
            except TypeError:
                print(
                    "Warning: set_header_text() failed (known python-hwpx bug). "
                    "Use unpack/pack workflow for headers.",
                    file=sys.stderr,
                )

        elif btype == "footer":
            try:
                doc.set_footer_text(block.get("text", ""), section=section)
            except TypeError:
                print(
                    "Warning: set_footer_text() failed (known python-hwpx bug). "
                    "Use unpack/pack workflow for footers.",
                    file=sys.stderr,
                )

    doc.save_to_path(output_path)
    print(f"Created: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create HWPX document from Markdown or JSON input"
    )
    parser.add_argument(
        "--input", "-i",
        help="Input file path (.md or .json). Reads from stdin if omitted.",
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output .hwpx file path",
    )
    parser.add_argument(
        "--format", "-f",
        choices=["md", "json", "auto"],
        default="auto",
        help="Input format (default: auto-detect from extension)",
    )
    args = parser.parse_args()

    # Read input
    if args.input:
        input_path = Path(args.input)
        if not input_path.is_file():
            print(f"Error: File not found: {args.input}", file=sys.stderr)
            sys.exit(1)
        text = input_path.read_text(encoding="utf-8")
        fmt = args.format
        if fmt == "auto":
            fmt = "json" if input_path.suffix.lower() == ".json" else "md"
    else:
        text = sys.stdin.read()
        fmt = args.format
        if fmt == "auto":
            # Try JSON first
            fmt = "json" if text.strip().startswith("{") else "md"

    # Parse
    if fmt == "json":
        blocks = parse_json_input(text)
    else:
        blocks = parse_markdown(text)

    if not blocks:
        print("Warning: No content blocks parsed from input.", file=sys.stderr)

    create_document(blocks, args.output)


if __name__ == "__main__":
    main()
