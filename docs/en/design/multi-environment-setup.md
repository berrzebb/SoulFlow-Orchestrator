# Design: Multi-Environment Setup — Container-Based Isolated Execution

> **Status**: Implementation complete

## Overview

Multi-Environment Setup provides isolated, containerized execution environments (development, testing, staging, production) for SoulFlow Orchestrator. Users run a single command (`make dev` or `run.cmd dev`) and the system handles all configuration, Docker composition, and service initialization automatically.

Key principle: **Users should never need to understand npm, docker commands, or Node.js versions.**

## Problem Statement

- **Before**: Users manually ran `npm install`, `npm run build`, `docker compose up`, etc.
- **Issue**: Non-technical users couldn't use the system; multiple users on same machine caused environment conflicts
- **Solution**: Single command per environment + automatic per-user isolation via containerized builds

## Architecture

```
User runs: ./run.sh dev  or  run.cmd dev  or  .\run.ps1 dev
    ↓
Shell script (run.sh / run.cmd / run.ps1)
    ↓
setup-environment.js (generates docker-compose.{profile}.yml + .env.{profile})
    ↓
docker compose up -d (starts isolated containers)
    ↓
Application running on http://localhost:4200
```

## Environment Profiles

| Profile | Port | Redis | Purpose | Workspace |
|---------|------|-------|---------|-----------|
| dev | 4200 | 6379 | Development, auto-reload | `/data/workspace-dev` |
| test | 4201 | 6380 | Testing, CI/CD isolation | `/data/workspace-test` |
| staging | 4202 | 6381 | Pre-production validation | `/data/workspace-staging` |
| prod | 4200 | 6379 | Production deployment | `/data` |

## Key Features

### 1. Platform-Agnostic Entry Points

Three scripts with identical command interface:
- **Makefile** (Linux/macOS): `make dev`, `make down`, etc.
- **run.cmd** (Windows Command Prompt): `run.cmd dev`, `run.cmd down`, etc.
- **run.ps1** (Windows PowerShell): `.\run.ps1 dev`, `.\run.ps1 down`, etc.

All delegate to the same JavaScript configuration generator (`setup-environment.js`).

### 2. Dynamic Docker Composition

- `setup-environment.js` generates `docker-compose.{profile}.yml` at runtime
- Supports custom workspace paths via `WORKSPACE` environment variable
- Per-user project isolation: `soulflow-{profile}-{username}` for shared systems

### 3. Container-Only Node Modules

- `.dockerignore` excludes local `node_modules` from Docker context
- All builds happen inside container (clean environment)
- Users never need to run `npm install` locally

### 4. Non-Technical Documentation

- **QUICKSTART.md**: 3 steps (Install Docker → Run command → Open browser)
- **ENVIRONMENT_SETUP.md**: Minimal operational info (port table, workspace override, stop command)
- **README.md quick start**: Setup wizard guides configuration (no manual `.env` editing)

## Files Modified

### Script Entry Points
- `Makefile` — Unix/Linux/macOS shell script interface
- `run.cmd` — Windows batch script interface
- `run.ps1` — Windows PowerShell script interface
- `setup-environment.js` — Dynamic Docker Compose + .env file generator

### Configuration
- `.env.example` — User-friendly configuration template
- `docker-compose.dev.yml`, `.test.yml`, `.staging.yml` — Auto-generated per environment

### Documentation
- `QUICKSTART.md` — Simplified to 3 steps, removed npm/Node.js/Git references
- `ENVIRONMENT_SETUP.md` — Minimal operational guide (45 lines → removed 400+ lines of technical detail)
- `README.md` (빠른 시작 section) — Non-technical quick start guide

### Removed/Simplified
- Deleted: All `npm run env:*` scripts (unnecessary abstraction layer)
- Removed from docs: npm install, npm build, docker exec, Node.js version requirements, .env manual editing

## Type Design

### EnvProfile (setup-environment.js)

```typescript
interface EnvProfile {
  name: string;                    // Display name (e.g., "Development")
  projectName: string;             // Docker project identifier
  webPort: number;                 // Web server port
  redisPort: number;               // Redis port
  workspace: string;               // Container workspace path
  nodeEnv: "development" | "test" | "production";
  debug: "true" | "false";
  composeFile: string;             // Output filename
  buildTarget: "dev" | "production" | "full";
}

const ENV_PROFILES: Record<string, EnvProfile> = {
  dev: { ... },
  test: { ... },
  staging: { ... },
  prod: { ... },
};
```

## Execution Flow

```
1. User types: make dev
   ↓
2. Makefile reads .env or CLI WORKSPACE variable
   ↓
3. Exports: WORKSPACE=/custom/path node setup-environment.js dev
   ↓
4. setup-environment.js:
   - Reads ENV_PROFILES["dev"]
   - Overrides workspace if WORKSPACE env var set
   - Generates docker-compose.dev.yml
   - Generates .env.dev
   - Prints summary
   ↓
5. docker compose -f docker-compose.dev.yml up -d
   ↓
6. Container starts, npm build + dev server runs inside
   ↓
7. User accesses http://localhost:4200
```

## User Isolation (Shared Systems)

When `WORKSPACE` environment variable is set during startup:

```bash
WORKSPACE=/home/alice/workspace make dev
```

The system:
1. Uses the custom workspace for data persistence
2. Modifies project name: `soulflow-dev-alice` (prevents port/volume conflicts)
3. Each user gets isolated: containers, volumes, data

## Testing

- Manual: `make dev`, `make test`, `make staging`, `make prod`
- Verify: `http://localhost:{port}` responds
- Stop: `make down`
- Multiple environments: Run in separate terminals simultaneously
- Custom workspace: `WORKSPACE=/custom/path make dev`

## Documentation Standards

All user-facing documents follow **non-technical, operations-friendly** style:
- ❌ No mention of npm, Node.js versions, docker commands, .env file syntax
- ✅ Simple task-oriented language: "Install Docker", "Run this command", "Open browser"
- ✅ Minimal command blocks, no build process explanations
- ✅ Reference-style (not tutorial-style) structure

## Impact on Existing Work

- **CI/CD**: Docker-based builds unaffected; all compilation still happens in container
- **Development**: `make dev` replaces previous `npm install + npm run dev` manual steps
- **Testing**: Separate `make test` environment keeps test runs isolated
- **Documentation**: All guides (QUICKSTART, ENVIRONMENT_SETUP, README) simplified
