# PPTX — pptx_builder.py 사용법

`scripts/pptx_builder.py`로 JSON 데이터 + 빌트인 테마로 슬라이드를 생성한다.

```bash
R=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
$R run --rm -v "$PWD:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q python-pptx &&
  python scripts/pptx_builder.py --slides slides.json --template business --output output.pptx
"
```

## 빌트인 --template

| 값 | 배경 | 강조색 | 폰트 | 용도 |
|----|------|--------|------|------|
| `business` | 네이비 다크 | 파랑 | Calibri | 기업 발표 |
| `minimal`  | 흰색/연회색 | 진회색 | Arial | 심플 보고 |
| `technical`| VS Code 다크 | 파랑 (#007acc) | Consolas | 기술/개발 |
| `pitch`    | 블랙 | 골드 | Georgia | 투자 제안 |

## slides.json — 슬라이드 타입

```json
[
  { "type": "title",   "title": "발표 제목",       "subtitle": "부제목 또는 날짜" },
  { "type": "content", "title": "슬라이드 제목",   "bullets": ["내용 A", "내용 B"] },
  { "type": "two_col", "title": "As-Is vs To-Be",  "left": ["현재 A"], "right": ["개선 A"] },
  { "type": "table",   "title": "데이터 요약",
    "headers": ["항목", "1Q", "2Q"],
    "rows": [["매출", "120만", "150만"], ["비용", "80만", "90만"]] },
  { "type": "image",   "title": "분석 결과",        "path": "chart.png" },
  { "type": "blank",   "title": "Q&A" }
]
```

## --custom-theme (선택)

빌트인 테마를 기반으로 원하는 필드만 JSON으로 덮어쓴다.

```json
{
  "bg_dark":        "0d1117",
  "bg_light":       "161b22",
  "accent":         "238636",
  "text_primary":   "e6edf3",
  "text_secondary": "8b949e",
  "font_title":     "Segoe UI",
  "font_body":      "Segoe UI"
}
```

```bash
python scripts/pptx_builder.py --slides slides.json --template minimal --custom-theme theme.json --output output.pptx
```
