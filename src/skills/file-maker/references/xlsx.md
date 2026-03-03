# XLSX 생성 레퍼런스

## pandas (데이터 중심) — 권장

```python
# script.py
import pandas as pd

data = {
    "날짜":  ["2024-01", "2024-02", "2024-03"],
    "매출":  [1200000,   1500000,   1350000],
    "비용":  [800000,    900000,    750000],
}
df = pd.DataFrame(data)
df["이익"] = df["매출"] - df["비용"]

with pd.ExcelWriter("output.xlsx", engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="월별실적", index=False)

print("saved: output.xlsx")
```

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q pandas openpyxl &&
  python script.py
"
```

## openpyxl (서식 중심)

```python
# script.py
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "보고서"

# 헤더 스타일
header_fill = PatternFill("solid", fgColor="2E5984")
header_font = Font(bold=True, color="FFFFFF", size=11)
thin = Side(style="thin")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

headers = ["항목", "1월", "2월", "3월", "합계"]
for col, header in enumerate(headers, start=1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.fill   = header_fill
    cell.font   = header_font
    cell.border = border
    cell.alignment = Alignment(horizontal="center")

# 데이터
rows = [
    ("매출", 1200000, 1500000, 1350000),
    ("비용",  800000,  900000,  750000),
]
for row_idx, row_data in enumerate(rows, start=2):
    for col_idx, value in enumerate(row_data, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=value)
        cell.border = border
        if col_idx > 1:
            cell.number_format = "#,##0"
            cell.alignment = Alignment(horizontal="right")

# 합계 열 (SUM 수식)
for row_idx in range(2, 2 + len(rows)):
    ws.cell(row=row_idx, column=5,
            value=f"=SUM(B{row_idx}:D{row_idx})")

# 열 너비 자동 조정
for col in ws.columns:
    max_len = max(len(str(cell.value or "")) for cell in col)
    ws.column_dimensions[get_column_letter(col[0].column)].width = max_len + 4

wb.save("output.xlsx")
print("saved: output.xlsx")
```

## 복수 시트 + 차트

```python
from openpyxl.chart import BarChart, Reference

# 차트 추가
chart = BarChart()
chart.title  = "월별 매출"
chart.y_axis.title = "금액"
chart.x_axis.title = "월"

data_ref = Reference(ws, min_col=2, max_col=4, min_row=1, max_row=3)
chart.add_data(data_ref, titles_from_data=True)
ws.add_chart(chart, "A6")

# 시트 추가
ws2 = wb.create_sheet("상세")
ws2["A1"] = "상세 데이터"
```
