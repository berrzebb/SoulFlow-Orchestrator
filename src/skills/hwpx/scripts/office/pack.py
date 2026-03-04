#!/usr/bin/env python3
"""Pack a directory back into an HWPX (ZIP) file.

The mimetype file is stored as the first entry with ZIP_STORED (no compression),
per OPC packaging conventions.

Usage:
    python pack.py input_dir/ output.hwpx
"""

import argparse
import sys
from pathlib import Path

# build_hwpx.py is in the parent directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_hwpx import pack_hwpx


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pack a directory into an HWPX (ZIP) file"
    )
    parser.add_argument("input", help="Input directory path")
    parser.add_argument("output", help="Output .hwpx file path")
    args = parser.parse_args()

    input_dir = Path(args.input)
    if not input_dir.is_dir():
        print(f"Error: Directory not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output)
    count = pack_hwpx(input_dir, output_path)

    print(f"Packed: {args.input} -> {args.output}")
    print(f"  Files: {count} entries (mimetype first, ZIP_STORED)")


if __name__ == "__main__":
    main()
