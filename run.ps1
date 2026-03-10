# SoulFlow Orchestrator 환경 관리 스크립트 (Windows PowerShell)
# 사용법: .\run.ps1 dev|test|staging|prod|down|status|logs|login|help
# 예시: .\run.ps1 dev --workspace=D:\soulflow

param(
  [Parameter(Position = 0)]
  [string]$Command = "help",
  [switch]$SkipLock,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = "Continue"

# Named 파라미터 파싱 — 소비된 값은 PositionalArgs에서 제외
$Workspace = $null
$WebPort = $null
$Instance = $null
$Watch = $null
$PositionalArgs = @()

for ($i = 0; $i -lt $Arguments.Count; $i++) {
  $arg = $Arguments[$i]
  if ($arg -match "^--workspace=(.+)$") {
    $val = $matches[1]
    if ($val -match "^=") {
      Write-Host "파라미터 오류: --workspace==... (= 기호가 두 개)" -ForegroundColor Red
      Write-Host "올바른 형식: --workspace=D:\path (= 한 개)" -ForegroundColor Yellow
      exit 1
    }
    $Workspace = $val
  } elseif ($arg -match "^--(web-port|webport)=(.+)$") {
    $WebPort = $matches[2]
  } elseif ($arg -match "^--(instance|name)=(.+)$") {
    $Instance = $matches[2]
  } elseif ($arg -match "^--(workspace)$" -and $i + 1 -lt $Arguments.Count) {
    $i++; $Workspace = $Arguments[$i]
  } elseif ($arg -match "^--(web-port|webport)$" -and $i + 1 -lt $Arguments.Count) {
    $i++; $WebPort = $Arguments[$i]
  } elseif ($arg -match "^--(instance|name)$" -and $i + 1 -lt $Arguments.Count) {
    $i++; $Instance = $Arguments[$i]
  } elseif ($arg -match "^--watch=(.+)$") {
    $Watch = $matches[1]
  } elseif ($arg -eq "--watch") {
    $Watch = "all"
  } elseif ($arg -eq "--skip-lock") {
    $SkipLock = $true
  } elseif ($arg -notmatch "^--") {
    $PositionalArgs += $arg
  }
}

# 환경별 프리셋 (docker-compose 환경변수만)
$Presets = @{
  dev     = @{ BUILD_TARGET="dev";        NODE_ENV="development"; DEBUG="true";  MEMORY="1G"; CPUS="2"; WEB_PORT="4200"; NODE_HEAP_MB="768"  }
  test    = @{ BUILD_TARGET="production"; NODE_ENV="test";        DEBUG="true";  MEMORY="1G"; CPUS="2"; WEB_PORT="4201"; NODE_HEAP_MB="768"  }
  staging = @{ BUILD_TARGET="production"; NODE_ENV="production";  DEBUG="false"; MEMORY="1G"; CPUS="2"; WEB_PORT="4202"; NODE_HEAP_MB="768"  }
  prod    = @{ BUILD_TARGET="full";       NODE_ENV="production";  DEBUG="false"; MEMORY="2G"; CPUS="4"; WEB_PORT="4200"; NODE_HEAP_MB="1536" }
}

function Write-Title {
  param([string]$Title)
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
  Write-Host "  $Title" -ForegroundColor Blue
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
}

function Show-Help {
  Write-Host ""
  Write-Title "SoulFlow Orchestrator 환경 관리"
  Write-Host ""
  Write-Host "사용법:" -ForegroundColor Yellow
  Write-Host "  .\run.ps1 [명령] [옵션]"
  Write-Host ""
  Write-Host "환경 시작:" -ForegroundColor Yellow
  Write-Host "  dev       - 개발 환경"
  Write-Host "  test      - 테스트 환경"
  Write-Host "  staging   - 스테이징 환경"
  Write-Host "  prod      - 프로덕션 환경"
  Write-Host ""
  Write-Host "관리:" -ForegroundColor Yellow
  Write-Host "  build     - 이미지 빌드"
  Write-Host "  down      - 모든 환경 중지"
  Write-Host "  status    - 환경 상태 확인"
  Write-Host "  logs [env]  - 로그 확인 (env 생략 시 전체)"
  Write-Host ""
  Write-Host "에이전트 로그인 (워크스페이스별 저장):" -ForegroundColor Yellow
  Write-Host "  login claude   - Claude 에이전트 로그인"
  Write-Host "  login codex    - Codex 에이전트 로그인"
  Write-Host "  login gemini   - Gemini 에이전트 로그인"
  Write-Host ""
  Write-Host "옵션 (모든 명령과 함께 사용 가능):" -ForegroundColor Yellow
  Write-Host "  --workspace=PATH   - 워크스페이스 경로 (필수)"
  Write-Host "  --instance=NAME    - 인스턴스 이름 (다중 인스턴스 스케일링)"
  Write-Host "  --web-port=PORT    - 웹 포트 (기본값: 환경별 다름)"
  Write-Host "  --watch            - 전체 소스 마운트 + 핫 리로드 (tsx watch)"
  Write-Host "  --watch=web        - 웹 소스만 마운트 + 핫 리로드"
  Write-Host "  --skip-lock        - 인스턴스 락 비활성화 (복구/디버그 전용)"
  Write-Host "  -SkipLock          - PowerShell named switch (동일 기능)"
  Write-Host ""
  Write-Host "예시:" -ForegroundColor Yellow
  Write-Host "  .\run.ps1 dev --workspace=D:\soulflow"
  Write-Host "  .\run.ps1 dev --workspace=D:\soulflow --instance=worker1 --web-port=4200"
  Write-Host "  .\run.ps1 login claude --workspace=D:\soulflow"
  Write-Host ""
}

function Start-Environment {
  param([string]$ProfileName)

  if (-not $Workspace) {
    Write-Host "--workspace 파라미터가 필요합니다." -ForegroundColor Red
    Write-Host "예시: .\run.ps1 $ProfileName --workspace=D:\soulflow" -ForegroundColor Yellow
    exit 1
  }

  $p = $Presets[$ProfileName]
  if (-not $p) {
    Write-Host "알 수 없는 프로필: $ProfileName" -ForegroundColor Red
    return
  }

  # 프로젝트명: soulflow-{profile}[-{instance}]
  $projectName = "soulflow-$ProfileName"
  if ($Instance) { $projectName += "-$Instance" }

  Write-Host ""
  Write-Host "🚀 $ProfileName 환경 시작 중..." -ForegroundColor Yellow
  Write-Host "   워크스페이스: $Workspace"
  Write-Host "   프로젝트: $projectName"
  if ($Instance) { Write-Host "   인스턴스: $Instance" }
  if ($Watch) { Write-Host "   watch: $Watch" -ForegroundColor Cyan }
  if ($SkipLock) { Write-Host "   skip lock: enabled" -ForegroundColor Yellow }
  Write-Host ""

  # .agents 디렉토리 사전 생성 (볼륨 마운트 요구사항)
  foreach ($agent in @(".claude", ".codex", ".gemini")) {
    $dir = Join-Path $Workspace ".agents\$agent"
    if (-not (Test-Path $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }

  # 프리셋 → 환경변수
  $env:DOCKER_BUILDKIT = 0
  $env:BUILD_TARGET = $p.BUILD_TARGET
  $env:NODE_ENV = $p.NODE_ENV
  $env:DEBUG = $p.DEBUG
  $env:MEMORY = $p.MEMORY
  $env:CPUS = $p.CPUS
  $env:HOST_WORKSPACE = $Workspace
  $env:PROJECT_NAME = $projectName
  $env:WEB_PORT = if ($WebPort) { $WebPort } else { $p.WEB_PORT }
  $env:SKIP_INSTANCE_LOCK = if ($SkipLock) { "1" } else { "0" }
  $env:NODE_HEAP_MB = $p.NODE_HEAP_MB

  # instance 모드: 기본 인프라(redis, docker-proxy)를 먼저 보장
  if ($Instance) {
    $baseProject = "soulflow-$ProfileName"
    $env:PROJECT_NAME = $baseProject
    docker compose -f docker/docker-compose.yml -p $baseProject up -d redis docker-proxy 2>$null
    $env:PROJECT_NAME = $projectName
  }

  # compose 실행
  $composeArgs = @("-f", "docker/docker-compose.yml")
  $effectiveWatch = if ($ProfileName -eq "dev" -and -not $Watch) { "all" } else { $Watch }
  if ($effectiveWatch -eq "all") {
    $composeArgs += @("-f", "docker/docker-compose.dev.override.yml")
  } elseif ($effectiveWatch -eq "web") {
    $composeArgs += @("-f", "docker/docker-compose.web-watch.override.yml")
  }
  if ($Instance) {
    $env:BASE_PROFILE = $ProfileName
    $composeArgs += @("-f", "docker/docker-compose.instance.override.yml")
  }
  # 기존 컨테이너 정지 (포트 해제 보장)
  $downArgs = $composeArgs + @("-p", $projectName, "down", "--remove-orphans")
  docker compose @downArgs 2>$null

  # watch=web: 이미지 빌드 없이 기존 이미지 사용
  $composeArgs += @("-p", $projectName, "up", "-d")
  if ($effectiveWatch -ne "web") { $composeArgs += "--build" }
  docker compose @composeArgs

  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ $ProfileName 환경이 시작되었습니다!" -ForegroundColor Green
    Write-Host "   프로젝트: $projectName" -ForegroundColor Green
    Write-Host "   웹 포트: $($env:WEB_PORT)" -ForegroundColor Green
    if ($SkipLock) { Write-Host "⚠ WARNING: instance lock disabled" -ForegroundColor Yellow }
    Write-Host ""

    # watch=web: 호스트에서 vite build --watch 실행 (dist/web → 컨테이너 마운트)
    if ($effectiveWatch -eq "web") {
      if (-not (Test-Path "dist/web")) { New-Item -ItemType Directory -Path "dist/web" -Force | Out-Null }
      Write-Host "👀 웹 소스 변경 감시 중... (Ctrl+C로 종료)" -ForegroundColor Cyan
      Write-Host "   web/src 변경 → dist/web 자동 빌드 → 컨테이너 반영" -ForegroundColor Cyan
      Write-Host ""
      Push-Location web
      try { npx vite build --watch }
      finally { Pop-Location }
    }
  } else {
    Write-Host ""
    Write-Host "환경 시작 실패" -ForegroundColor Red
    Write-Host ""
  }
}

function Stop-AllEnvironments {
  Write-Host ""
  Write-Host "모든 환경 중지 중..." -ForegroundColor Yellow
  Write-Host ""

  docker compose -f docker/docker-compose.yml down -v 2>$null

  Write-Host ""
  Write-Host "✅ 모든 환경이 중지되었습니다" -ForegroundColor Green
  Write-Host ""
}

function Show-Status {
  Write-Host ""
  Write-Host "환경 상태:" -ForegroundColor Blue
  Write-Host ""
  docker compose ps
  Write-Host ""
}

function Show-Logs {
  param([string]$ProfileName)

  $projectName = if ($ProfileName) {
    $n = "soulflow-$ProfileName"
    if ($Instance) { $n += "-$Instance" }
    $n
  } else { $null }

  Write-Host ""
  if ($projectName) {
    Write-Host "로그 확인 중: $projectName (Ctrl+C로 종료)" -ForegroundColor Blue
  } else {
    Write-Host "로그 확인 중... (Ctrl+C로 종료)" -ForegroundColor Blue
  }
  Write-Host ""

  if ($projectName) {
    docker compose -f docker/docker-compose.yml -p $projectName logs -f
  } else {
    docker compose logs -f
  }
}

function Start-AgentLogin {
  param([string]$Agent)

  if (-not $Workspace) {
    Write-Host "--workspace 파라미터가 필요합니다." -ForegroundColor Red
    Write-Host "예시: .\run.ps1 login $Agent --workspace=D:\soulflow" -ForegroundColor Yellow
    exit 1
  }

  $AgentsDir = Join-Path $Workspace ".agents"

  switch ($Agent.ToLower()) {
    "claude" {
      Write-Host "🔑 Claude 에이전트 로그인 중..." -ForegroundColor Yellow
      $dir = Join-Path $AgentsDir ".claude"
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      docker run --rm -it -v "${dir}:/root/.claude" soulflow-orchestrator claude login
    }
    "codex" {
      Write-Host "🔑 Codex 에이전트 로그인 중..." -ForegroundColor Yellow
      $dir = Join-Path $AgentsDir ".codex"
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      docker run --rm -it -p 1455:1456 -v "${dir}:/root/.codex" -v "$(Get-Location)\scripts\oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
    }
    "gemini" {
      Write-Host "🔑 Gemini 에이전트 로그인 중..." -ForegroundColor Yellow
      $dir = Join-Path $AgentsDir ".gemini"
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      docker run --rm -it -v "${dir}:/root/.gemini" soulflow-orchestrator gemini auth login
    }
    default {
      Write-Host "알 수 없는 에이전트: $Agent" -ForegroundColor Red
      Write-Host "사용법: .\run.ps1 login [claude|codex|gemini]"
    }
  }
  Write-Host ""
}

# 메인 실행
switch ($Command.ToLower()) {
  "help"    { Show-Help }
  "dev"     { Start-Environment "dev" }
  "test"    { Start-Environment "test" }
  "staging" { Start-Environment "staging" }
  "prod"    { Start-Environment "prod" }
  "build" {
    Write-Host ""
    Write-Host "🔨 이미지 빌드 중..." -ForegroundColor Yellow
    $env:DOCKER_BUILDKIT = 0
    docker compose -f docker/docker-compose.yml build
    if ($LASTEXITCODE -eq 0) {
      Write-Host ""
      Write-Host "✅ 이미지 빌드 완료" -ForegroundColor Green
    } else {
      Write-Host ""
      Write-Host "이미지 빌드 실패" -ForegroundColor Red
    }
    Write-Host ""
  }
  "down"    { Stop-AllEnvironments }
  "status"  { Show-Status }
  "logs" {
    $ProfileArg = $PositionalArgs | Select-Object -First 1
    Show-Logs $ProfileArg
  }
  "login" {
    $Agent = $PositionalArgs | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($Agent)) {
      Write-Host "에이전트를 지정하세요" -ForegroundColor Red
      Write-Host "사용법: .\run.ps1 login [claude|codex|gemini]"
    } else {
      Start-AgentLogin $Agent
    }
  }
  default {
    Write-Host "알 수 없는 명령어: $Command" -ForegroundColor Red
    Write-Host ""
    Show-Help
  }
}
