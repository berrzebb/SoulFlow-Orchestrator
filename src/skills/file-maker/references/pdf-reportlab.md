# PDF — reportlab (프로그래밍 방식)

좌표 기반의 정밀한 레이아웃, 차트 내장, 동적 콘텐츠 생성에 적합.
weasyprint(HTML→PDF)보다 복잡하지만 표현 범위가 넓다.

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q reportlab && python script.py
"
```

## 기본 문서 (Platypus — 흐름 기반)

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors

doc    = SimpleDocTemplate("output.pdf", pagesize=A4)
styles = getSampleStyleSheet()
story  = []

story.append(Paragraph("보고서 제목", styles["Title"]))
story.append(Spacer(1, 12))
story.append(Paragraph("본문 내용입니다.", styles["Normal"]))

data = [["항목", "값",   "비고"],
        ["A",   "100", "정상"],
        ["B",   "200", "주의"]]
t = Table(data)
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.steelblue),
    ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
    ("GRID",       (0, 0), (-1, -1), 0.5, colors.grey),
    ("FONTSIZE",   (0, 0), (-1, -1), 10),
]))
story.append(t)

doc.build(story)
print("saved: output.pdf")
```

## 직접 좌표 드로잉 (Canvas)

```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm

c = canvas.Canvas("output.pdf", pagesize=A4)
w, h = A4

c.setFont("Helvetica-Bold", 24)
c.drawCentredString(w / 2, h - 3 * cm, "페이지 제목")

c.setFont("Helvetica", 12)
c.drawString(2 * cm, h - 5 * cm, "본문 텍스트")

c.setStrokeColorRGB(0.2, 0.4, 0.8)
c.setLineWidth(2)
c.line(2 * cm, h - 3.5 * cm, w - 2 * cm, h - 3.5 * cm)

c.showPage()
c.save()
print("saved: output.pdf")
```

## 한글 폰트 등록

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("NanumGothic", "/usr/share/fonts/NanumGothic.ttf"))
styles["Normal"].fontName = "NanumGothic"
```

> 컨테이너에 한글 폰트가 없으면 `apt-get install -y fonts-nanum` 으로 설치.

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  apt-get update -qq && apt-get install -y -q fonts-nanum &&
  pip install -q reportlab &&
  python script.py
"
```
