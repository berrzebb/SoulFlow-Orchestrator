# PDF — weasyprint (HTML → PDF)

HTML/CSS로 레이아웃을 잡고 PDF로 변환한다.
표·이미지·한글 폰트가 포함된 보고서에 적합. Markdown 변환도 지원.

```bash
R=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
$R run --rm -v "$PWD:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q weasyprint && python script.py
"
```

## HTML → PDF

```python
from weasyprint import HTML

html = """<!DOCTYPE html>
<html><head><meta charset='utf-8'>
<style>
  body  { font-family: 'Noto Sans KR', sans-serif; margin: 40px; }
  h1    { color: #2c3e50; border-bottom: 2px solid #3498db; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; border: 1px solid #ddd; }
  th    { background: #3498db; color: white; }
</style></head>
<body>
  <h1>보고서 제목</h1>
  <p>내용...</p>
  <table>
    <tr><th>항목</th><th>값</th></tr>
    <tr><td>A</td><td>100</td></tr>
  </table>
</body></html>"""

HTML(string=html).write_pdf("output.pdf")
print("saved: output.pdf")
```

## Markdown → PDF

```python
import markdown2
from weasyprint import HTML

md_text  = open("input.md", encoding="utf-8").read()
html_body = markdown2.markdown(md_text, extras=["tables", "fenced-code-blocks"])
full_html = f"""<html><head><meta charset='utf-8'>
<style>
  body {{ font-family: sans-serif; margin: 40px; line-height: 1.6 }}
  code {{ background: #f4f4f4; padding: 2px 6px; border-radius: 3px }}
  pre  {{ background: #f4f4f4; padding: 16px; border-radius: 6px }}
</style></head><body>{html_body}</body></html>"""

HTML(string=full_html).write_pdf("output.pdf")
print("saved: output.pdf")
```

```bash
$R run --rm -v "$PWD:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q weasyprint markdown2 && python script.py
"
```
