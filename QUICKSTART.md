# Quick Start

## 1. Install Container Software

Download and install one of:
- Docker Desktop (Windows/macOS)
- Podman (Linux)

Start the software before running the application.

## 2. Open the Application

In your terminal/command prompt, go to the project folder and run:

**Linux/macOS:**
```bash
./run.sh dev
```

**Windows (Command Prompt):**
```cmd
run.cmd dev
```

**Windows (PowerShell):**
```powershell
.\run.ps1 dev
```

Then open your browser: http://localhost:4200

## 3. Stop the Application

**Linux/macOS:**
```bash
./run.sh down
```

**Windows:**
```
run.cmd down
```

## Running Different Environments

To use a different environment, replace `dev` with one of:
- `test` (port 4201)
- `staging` (port 4202)
- `prod` (port 4200)
