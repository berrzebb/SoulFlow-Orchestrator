# SQLite — Python 컨테이너 내 실행

SQLite는 Python 표준 라이브러리(`sqlite3`)에 내장 — pip 설치 없이 사용 가능.
파일 기반 로컬 DB 작업에 적합. PostgreSQL/MySQL 연결이 필요하면 `temp-db` 스킬 사용.

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim python script.py
```

---

## 기본 패턴

```python
import sqlite3

conn = sqlite3.connect("data.db")   # 파일 DB (workspace에 저장)
# conn = sqlite3.connect(":memory:")  # 인메모리 DB (컨테이너 종료 시 사라짐)

cur = conn.cursor()

# 테이블 생성
cur.execute("""
    CREATE TABLE IF NOT EXISTS sales (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        date    TEXT NOT NULL,
        amount  REAL NOT NULL,
        item    TEXT
    )
""")

# 데이터 삽입
cur.executemany("INSERT INTO sales (date, amount, item) VALUES (?, ?, ?)", [
    ("2024-01", 1200000, "A"),
    ("2024-02", 1500000, "B"),
])
conn.commit()

# 조회
for row in cur.execute("SELECT * FROM sales ORDER BY date"):
    print(row)

conn.close()
```

---

## CSV → SQLite 로드

```python
import sqlite3, csv

conn = sqlite3.connect("data.db")
cur  = conn.cursor()

with open("input.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    headers = reader.fieldnames
    cols    = ", ".join(f"{h} TEXT" for h in headers)
    cur.execute(f"CREATE TABLE IF NOT EXISTS data ({cols})")

    placeholders = ", ".join("?" * len(headers))
    for row in reader:
        cur.execute(f"INSERT INTO data VALUES ({placeholders})", list(row.values()))

conn.commit()

# 확인
for row in cur.execute("SELECT * FROM data LIMIT 5"):
    print(row)
conn.close()
print("loaded to data.db")
```

---

## pandas ↔ SQLite

```python
import sqlite3, pandas as pd

conn = sqlite3.connect("data.db")

# DataFrame → SQLite
df = pd.read_csv("input.csv")
df.to_sql("table_name", conn, if_exists="replace", index=False)

# SQLite → DataFrame
df2 = pd.read_sql("SELECT * FROM table_name WHERE amount > 1000", conn)
print(df2.head())

conn.close()
```

```powershell
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q pandas &&
  python script.py
"
```

---

## 결과를 파일로 내보내기

```python
import sqlite3, csv, json

conn = sqlite3.connect("data.db")
cur  = conn.cursor()
rows = cur.execute("SELECT * FROM sales").fetchall()
cols = [d[0] for d in cur.description]

# CSV 출력
with open("output.csv", "w", newline="", encoding="utf-8") as f:
    csv.DictWriter(f, fieldnames=cols).writeheader()
    csv.DictWriter(f, fieldnames=cols).writerows(dict(zip(cols, r)) for r in rows)

# JSON 출력
with open("output.json", "w", encoding="utf-8") as f:
    json.dump([dict(zip(cols, r)) for r in rows], f, ensure_ascii=False, indent=2)

conn.close()
```

---

## temp-db 스킬과의 선택 기준

| 상황 | 스킬 |
|------|------|
| 파일 기반 경량 DB, 로컬 분석 | `python-sandbox` + sqlite3 |
| 외부 PostgreSQL/MySQL 서버 연결 | `temp-db` |
| 대용량 데이터 + SQL 분석 엔진 | `python-sandbox` + DuckDB (`pip install duckdb`) |
