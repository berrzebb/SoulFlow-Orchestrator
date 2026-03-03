# DOCX — python-docx 직접 API

docx_builder.py로 커버되지 않는 세밀한 스타일 제어가 필요할 때 사용한다.
(ex: 헤더/푸터 커스텀, 스타일 상속 수정, 기존 파일 편집)

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q python-docx && python script.py
"
```

## 기본 구조

```python
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
for section in doc.sections:
    section.top_margin  = Cm(2.5)
    section.left_margin = Cm(3.0)

h = doc.add_heading("문서 제목", level=1)
h.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_paragraph("본문 내용")

p = doc.add_paragraph()
p.add_run("굵게").bold = True
p.add_run("와 ")
r = p.add_run("기울임")
r.italic = True

doc.save("output.docx")
```

## 스타일 직접 지정

```python
para = doc.add_paragraph()
run  = para.add_run("강조 텍스트")
run.font.name       = "Malgun Gothic"
run.font.size       = Pt(12)
run.font.color.rgb  = RGBColor(0x2E, 0x59, 0x84)
run.font.bold       = True
```

## 표 삽입

```python
table = doc.add_table(rows=1, cols=3)
table.style = "Table Grid"

hdr = table.rows[0].cells
hdr[0].text, hdr[1].text, hdr[2].text = "항목", "값", "비고"

for row_data in [("A", "100", "정상"), ("B", "200", "주의")]:
    row = table.add_row().cells
    for i, val in enumerate(row_data):
        row[i].text = val
```

## 불릿 / 번호 목록

```python
for item in ["항목 A", "항목 B"]:
    doc.add_paragraph(item, style="List Bullet")

for step in ["단계 1", "단계 2"]:
    doc.add_paragraph(step, style="List Number")
```

## 이미지 삽입

```python
from docx.shared import Inches
doc.add_picture("chart.png", width=Inches(6))
```

## 페이지 나누기

```python
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

p   = doc.add_paragraph()
run = p.add_run()
br  = OxmlElement("w:br")
br.set(qn("w:type"), "page")
run._r.append(br)
```

## 헤더 / 푸터

```python
section = doc.sections[0]
header  = section.header
header.paragraphs[0].text = "문서 헤더"

footer  = section.footer
footer.paragraphs[0].text = "페이지 하단"
```

## 기존 DOCX 파일 편집

```python
doc = Document("existing.docx")
for para in doc.paragraphs:
    for run in para.runs:
        if "교체 전" in run.text:
            run.text = run.text.replace("교체 전", "교체 후")
doc.save("modified.docx")
```
