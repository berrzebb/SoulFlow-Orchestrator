# DOCX — docx_builder.py 사용법

`scripts/docx_builder.py`로 JSON 데이터 + 빌트인 템플릿으로 문서를 생성한다.

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q python-docx &&
  python scripts/docx_builder.py --content content.json --template report --output output.docx
"
```

## 빌트인 --template

| 값 | 여백 | 줄간격 | 용도 |
|----|------|--------|------|
| `report`   | 3.0cm | 1.15 | 공식 보고서 (헤딩 네이비) |
| `memo`     | 2.5cm | 1.0  | 사내 메모 (헤딩 회색) |
| `proposal` | 3.5cm | 1.5  | 제안서 (헤딩 진파랑) |
| `letter`   | 4.0cm | 1.5  | 공문/서신 (헤딩 검정, Batang) |

## content.json — 섹션 타입

```json
{
  "title": "2024년 1분기 보고서",
  "meta": { "author": "홍길동", "date": "2024-04-01", "subject": "실적 분석" },
  "sections": [
    { "type": "heading",   "text": "1. 개요",          "level": 1 },
    { "type": "paragraph", "text": "본문 내용입니다." },
    { "type": "bullets",   "items": ["항목 A", "항목 B"] },
    { "type": "numbers",   "items": ["단계 1", "단계 2"] },
    { "type": "table",
      "headers": ["항목", "목표", "실적"],
      "rows":    [["매출", "10억", "11.5억"]] },
    { "type": "image",      "path": "chart.png", "width_cm": 14 },
    { "type": "page_break" }
  ]
}
```

## --custom-theme (선택)

빌트인 템플릿을 기반으로 원하는 필드만 JSON으로 덮어쓴다.

```json
{
  "heading1_color": "8B0000",
  "heading2_color": "B22222",
  "body_font":      "NanumGothic",
  "heading_font":   "NanumGothic",
  "font_size_body": 11,
  "margin_left_cm": 4.0,
  "line_spacing":   1.8
}
```

```powershell
python scripts/docx_builder.py --content content.json --template report --custom-theme theme.json --output output.docx
```
