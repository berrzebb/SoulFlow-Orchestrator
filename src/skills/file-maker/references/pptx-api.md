# PPTX — python-pptx 직접 API

pptx_builder.py로 커버되지 않는 레이아웃이 필요할 때 사용한다.
(ex: 커스텀 애니메이션 구조, 마스터 슬라이드 수정, 기존 파일 편집)

```bash
R=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
$R run --rm -v "$PWD:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q python-pptx && python script.py
"
```

## 기본 구조

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width  = Inches(13.33)   # 와이드스크린 16:9
prs.slide_height = Inches(7.5)

slide = prs.slides.add_slide(prs.slide_layouts[6])  # 빈 레이아웃(6)

# 텍스트박스
txb = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(11), Inches(2))
tf  = txb.text_frame
tf.word_wrap = True
p   = tf.paragraphs[0]
p.alignment = PP_ALIGN.CENTER
run = p.add_run()
run.text           = "제목 텍스트"
run.font.size      = Pt(40)
run.font.bold      = True
run.font.color.rgb = RGBColor(0xff, 0xff, 0xff)

prs.save("output.pptx")
print("saved: output.pptx")
```

## 도형 + 배경색

```python
# 배경 채우기
bg = slide.background.fill
bg.solid()
bg.fore_color.rgb = RGBColor(0x1a, 0x1a, 0x2e)

# 직사각형 도형 (MSO_SHAPE_TYPE.RECTANGLE = 1)
bar = slide.shapes.add_shape(1, 0, 0, prs.slide_width, Inches(1.2))
bar.fill.solid()
bar.fill.fore_color.rgb = RGBColor(0x0f, 0x3f, 0x5c)
bar.line.fill.background()   # 테두리 제거
```

## 이미지 삽입

```python
slide.shapes.add_picture("chart.png", Inches(1), Inches(2), Inches(8), Inches(4.5))
```

## 표 삽입

```python
rows, cols = 4, 3
table = slide.shapes.add_table(rows, cols, Inches(1), Inches(2), Inches(10), Inches(3)).table

headers = ["항목", "값", "비고"]
for i, h in enumerate(headers):
    cell = table.cell(0, i)
    cell.text = h
    run  = cell.text_frame.paragraphs[0].runs[0]
    run.font.bold = True
    run.font.size = Pt(14)
```

## 기존 PPTX 파일 편집

```python
prs = Presentation("existing.pptx")   # 기존 파일 열기
slide = prs.slides[0]

for shape in slide.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if "교체 전" in run.text:
                    run.text = run.text.replace("교체 전", "교체 후")

prs.save("modified.pptx")
```
