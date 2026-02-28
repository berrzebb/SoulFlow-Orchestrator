---
name: temp-db
description: Access PostgreSQL and MySQL databases through ephemeral containers so no DB tools remain on host. Use for one-off queries, schema inspection, migrations, or connecting to external databases. Container sandbox is mandatory. Do NOT install psql/mysql on host. Do NOT use for persistent database servers.
metadata:
  model: local
  tools:
    - exec
  triggers:
    - 데이터베이스
    - DB
    - postgres
    - mysql
    - sql
  aliases:
    - database
---

# temp-db

## Quick Reference

| Task | Command |
|------|---------|
| Local PostgreSQL | `$R run -d --rm --name $N -e POSTGRES_USER=postgres ... postgres:16` |
| Run SQL | `$R exec -i $N psql -U postgres -d appdb -c "select now();"` |
| Remote PG query | `$R run --rm -e PGPASSWORD="..." postgres:16 psql -h host ...` |
| MySQL query | `$R run --rm mysql:8 mysql -h host -e "select now();"` |
| Cleanup | `$R rm -f $N` |

Container sandbox mandatory. Never install `psql`/`mysql` on host.

## Runtime Selection

`podman` first, fallback to `docker`. No host fallback.

```powershell
$R = if (Get-Command podman -ErrorAction SilentlyContinue) { "podman" } elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker" } else { throw "container_runtime_not_found" }
```

## Mode A: Ephemeral Local DB

```powershell
$N = "pg-tmp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
& $R run -d --rm --name $N -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=appdb -p "55432:5432" postgres:16

# Wait until ready
for($i=0; $i -lt 30; $i++){ & $R exec $N pg_isready -U postgres -d appdb *> $null; if($LASTEXITCODE -eq 0){ break }; Start-Sleep -Seconds 1 }

# Run SQL
& $R exec -i $N psql -U postgres -d appdb -v ON_ERROR_STOP=1 -c "select now();"

# Run file
Get-Content .\query.sql -Raw | & $R exec -i $N psql -U postgres -d appdb -v ON_ERROR_STOP=1

# Cleanup
& $R stop $N
```

## Mode B: Remote DB Access

```powershell
# PostgreSQL one-shot
& $R run --rm -e PGPASSWORD="$env:DB_PASSWORD" postgres:16 `
  psql -h "$env:DB_HOST" -p "${env:DB_PORT}" -U "$env:DB_USER" -d "$env:DB_NAME" -v ON_ERROR_STOP=1 -c "select now();"

# MySQL one-shot
& $R run --rm mysql:8 mysql -h "$env:DB_HOST" -P "${env:DB_PORT}" -u"$env:DB_USER" -p"$env:DB_PASSWORD" "$env:DB_NAME" -e "select now();"
```

One-shot commands use `--rm` for automatic cleanup. Detached mode requires explicit `$R rm -f $N`.
