# Docker Configuration

This directory contains Docker Compose configuration files for running SoulFlow Orchestrator in different environments.

## Generated Files

The following files are **automatically generated** by `setup-environment.js`:

- `docker-compose.dev.yml` — Development environment (source mount, auto-reload)
- `docker-compose.test.yml` — Test environment (isolated testing)
- `docker-compose.staging.yml` — Staging environment (pre-deployment validation)
- `docker-compose.prod.yml` — Production environment (optimized resource limits)

## How to Use

Run the appropriate shell script to generate configurations for your environment:

**Linux/macOS:**
```bash
./run.sh dev        # Generates docker/docker-compose.dev.yml
./run.sh test       # Generates docker/docker-compose.test.yml
./run.sh staging    # Generates docker/docker-compose.staging.yml
./run.sh prod       # Generates docker/docker-compose.prod.yml
```

**Windows (Command Prompt):**
```cmd
run.cmd dev         # Generates docker/docker-compose.dev.yml
```

**Windows (PowerShell):**
```powershell
.\run.ps1 dev       # Generates docker/docker-compose.dev.yml
```

## Configuration Parameters

Each environment can be customized via named parameters:

```bash
./run.sh dev --workspace=/custom/path --web-port=8080 --redis-port=6380
```

Environment variables are written to `.env.{profile}` in the project root.

## Directory Structure

```
docker/
├── README.md                      (This file)
├── .gitkeep                       (Ensures directory exists in git)
├── docker-compose.dev.yml         (Generated - development)
├── docker-compose.test.yml        (Generated - testing)
├── docker-compose.staging.yml     (Generated - staging)
└── docker-compose.prod.yml        (Generated - production)
```

Generated files are ignored by `.gitignore`.
