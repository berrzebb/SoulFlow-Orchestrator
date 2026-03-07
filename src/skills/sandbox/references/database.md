# PostgreSQL / MySQL 연결

외부 DB 서버 연결 또는 임시 로컬 DB 실행. 파일 기반 로컬 DB는 [sqlite.md](sqlite.md) 참조.

---

## PostgreSQL

### 외부 서버 연결 (one-shot)

```bash
R=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)

$R run --rm \
  -e PGPASSWORD="$DB_PASSWORD" \
  postgres:16 \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -c "SELECT now();"
```

### SQL 파일 실행

```bash
cat query.sql | $R run --rm -i \
  -e PGPASSWORD="$DB_PASSWORD" postgres:16 \
  psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
```

### 임시 로컬 PostgreSQL 서버

```bash
N="pg-$(head -c4 /dev/urandom | xxd -p)"

# 서버 시작
$R run -d --rm --name "$N" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=appdb \
  postgres:16

# 준비 대기
for i in $(seq 1 30); do
  $R exec "$N" pg_isready -U postgres -d appdb >/dev/null 2>&1 && break
  sleep 1
done

# 쿼리 실행
$R exec -i "$N" psql -U postgres -d appdb -v ON_ERROR_STOP=1 -c "
  CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT);
  INSERT INTO test (name) VALUES ('hello'), ('world');
  SELECT * FROM test;
"

# 정리
$R rm -f "$N"
```

---

## MySQL

### 외부 서버 연결 (one-shot)

```bash
$R run --rm mysql:8 \
  mysql -h "$DB_HOST" -P "$DB_PORT" \
  -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  -e "SELECT now();"
```

### SQL 파일 실행

```bash
cat query.sql | $R run --rm -i mysql:8 \
  mysql -h "$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"
```

### 임시 로컬 MySQL 서버

```bash
N="my-$(head -c4 /dev/urandom | xxd -p)"

$R run -d --rm --name "$N" \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=appdb \
  mysql:8

# 준비 대기
for i in $(seq 1 30); do
  $R exec "$N" mysqladmin ping -u root -proot >/dev/null 2>&1 && break
  sleep 2
done

$R exec -i "$N" mysql -u root -proot appdb -e "SELECT now();"

$R rm -f "$N"
```

---

## Python으로 DB 쿼리 결과 처리

psql/mysql CLI 대신 Python + DB 드라이버로 결과를 파일로 저장할 때.

```python
import psycopg2, pandas as pd, os

conn = psycopg2.connect(
    host=os.environ["DB_HOST"], port=os.environ.get("DB_PORT", 5432),
    user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
    dbname=os.environ["DB_NAME"],
)
df = pd.read_sql("SELECT * FROM orders WHERE created_at > '2024-01-01'", conn)
df.to_csv("orders.csv", index=False)
conn.close()
print(f"saved: orders.csv ({len(df)} rows)")
```

```bash
$R run --rm -v "$PWD:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  pip install -q psycopg2-binary pandas &&
  python script.py
" \
  -e DB_HOST="$DB_HOST" \
  -e DB_USER="$DB_USER" \
  -e DB_PASSWORD="$DB_PASSWORD" \
  -e DB_NAME="$DB_NAME"
```

---

## DB 선택 기준

| 상황 | 방법 |
|------|------|
| 로컬 파일 기반 경량 DB | SQLite → [sqlite.md](sqlite.md) |
| 대용량 CSV/파케이 분석 | DuckDB → [python.md](python.md) |
| 외부 PostgreSQL 서버 쿼리 | postgres:16 one-shot |
| 외부 MySQL 서버 쿼리 | mysql:8 one-shot |
| 결과를 파일로 저장 필요 | Python + psycopg2/mysqlclient |
