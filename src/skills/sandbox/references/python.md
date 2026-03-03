# Python 실행 패턴

이미지: `python:3.12-slim`

## 표준 실행 (requirements.txt)

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q -r requirements.txt &&
  python script.py
"
```

`write_file`로 `script.py`와 `requirements.txt`를 workspace에 먼저 저장.

## 인라인 pip 설치 (requirements.txt 없이)

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q pandas openpyxl requests &&
  python script.py
"
```

## 자주 쓰는 패키지

| 용도 | 패키지 |
|------|--------|
| 데이터 분석 | `pandas numpy` |
| 엑셀 읽기/쓰기 | `openpyxl pandas` |
| HTTP 요청 | `requests httpx` |
| HTML 파싱 | `beautifulsoup4 lxml` |
| PDF 생성 | `weasyprint` |
| PPTX 생성 | `python-pptx` |
| DOCX 생성 | `python-docx` |
| 이미지 처리 | `Pillow` |
| 차트 | `matplotlib seaborn plotly` |
| 머신러닝 | `scikit-learn` |
| 분석 DB | `duckdb` |

## 데이터 분석 패턴

```python
import pandas as pd

df = pd.read_csv("input.csv")
print(df.describe())

# 집계
summary = df.groupby("category")["value"].agg(["sum", "mean", "count"])
summary.to_csv("output.csv", index=True)
print("saved: output.csv")
```

## HTTP 요청

```python
import requests, json

resp = requests.get("https://api.example.com/data", timeout=10)
resp.raise_for_status()
data = resp.json()

with open("output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("saved: output.json")
```

## 한글 폰트 (PDF 생성 시)

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  apt-get update -qq && apt-get install -y -q fonts-nanum &&
  pip install -q weasyprint &&
  python script.py
"
```

## DuckDB (대용량 SQL 분석)

```python
import duckdb

conn = duckdb.connect()

# CSV 직접 쿼리 (메모리 효율적)
result = conn.execute("""
    SELECT category, SUM(amount) as total
    FROM read_csv_auto('input.csv')
    GROUP BY category
    ORDER BY total DESC
""").fetchdf()

result.to_csv("output.csv", index=False)
print("saved: output.csv")
```

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q duckdb &&
  python script.py
"
```
