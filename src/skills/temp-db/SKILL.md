---
name: temp-db
description: Access databases through ephemeral containers so no DB tools remain on host.
---

# temp-db

Use this skill for one-off DB queries, schema checks, migrations, or test data validation without leaving DB tooling on host.

## Policy

- Container sandbox is mandatory.
- Never run host DB server/client directly for this task.
- Never install `psql`/`mysql`/other DB clients on host.
- Use temporary container only (`--rm`) for DB access.
- Do not create persistent volumes unless explicitly requested.
- Use container-internal client (`psql`, `mysql`) instead of host client.
- Stop/remove container immediately after work.

## Runtime Selection

Use `podman` first, fallback to `docker`. If neither exists, fail the task (no host fallback).

```powershell
$R = if (Get-Command podman -ErrorAction SilentlyContinue) { "podman" } elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker" } else { throw "container_runtime_not_found" }
```

## Mode A: Ephemeral Local DB (scratch/testing)

Start:

```powershell
$N = "pg-tmp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$P = 55432
& $R run -d --rm --name $N -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=appdb -p "${P}:5432" postgres:16
```

Wait until ready:

```powershell
for($i=0; $i -lt 30; $i++){ & $R exec $N pg_isready -U postgres -d appdb *> $null; if($LASTEXITCODE -eq 0){ break }; Start-Sleep -Seconds 1 }
```

Run SQL:

```powershell
& $R exec -i $N psql -U postgres -d appdb -v ON_ERROR_STOP=1 -c "select now();"
```

Run file:

```powershell
Get-Content .\query.sql -Raw | & $R exec -i $N psql -U postgres -d appdb -v ON_ERROR_STOP=1
```

Cleanup:

```powershell
& $R stop $N
```

## Mode B: External DB Access (no host DB client)

Run PostgreSQL query against existing DB with one-shot container:

```powershell
& $R run --rm -e PGPASSWORD="$env:DB_PASSWORD" postgres:16 `
  psql -h "$env:DB_HOST" -p "${env:DB_PORT}" -U "$env:DB_USER" -d "$env:DB_NAME" -v ON_ERROR_STOP=1 -c "select now();"
```

Run PostgreSQL SQL file with one-shot container:

```powershell
Get-Content .\query.sql -Raw | & $R run --rm -i -e PGPASSWORD="$env:DB_PASSWORD" postgres:16 `
  psql -h "$env:DB_HOST" -p "${env:DB_PORT}" -U "$env:DB_USER" -d "$env:DB_NAME" -v ON_ERROR_STOP=1
```

Run MySQL query with one-shot container:

```powershell
& $R run --rm mysql:8 mysql -h "$env:DB_HOST" -P "${env:DB_PORT}" -u"$env:DB_USER" -p"$env:DB_PASSWORD" "$env:DB_NAME" -e "select now();"
```

## Cleanup Guarantee

- One-shot commands use `--rm`, so client container is deleted automatically.
- If detached mode was used, stop/remove explicitly:

```powershell
& $R rm -f $N 2>$null
```
