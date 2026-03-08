# SoulFlow Orchestrator 환경 관리 스크립트 (Windows PowerShell)
# 사용법: .\run.ps1 dev|test|staging|prod|down|status|logs|help
# 워크스페이스: $env:WORKSPACE="D:\custom\path" .\run.ps1 dev

param(
  [Parameter(Position = 0)]
  [string]$Command = "help",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = "Continue"

# Named 파라미터 파싱
$Workspace = "/data"
$WebPort = $null
$RedisPort = $null
$Instance = $null

foreach ($arg in $Arguments) {
  if ($arg -match "^--workspace=(.+)$") {
    $val = $matches[1]
    if ($val -match "^=") {
      Write-Host "❌ 파라미터 오류: --workspace==... (= 기호가 두 개)" -ForegroundColor Red
      Write-Host "올바른 형식: --workspace=D:\path (= 한 개)" -ForegroundColor Yellow
      exit 1
    }
    $Workspace = $val
  } elseif ($arg -match "^--(web-port|webport)=(.+)$") {
    $WebPort = $matches[2]
  } elseif ($arg -match "^--(redis-port|redisport)=(.+)$") {
    $RedisPort = $matches[2]
  } elseif ($arg -match "^--(instance|name)=(.+)$") {
    $Instance = $matches[2]
  }
}

function Write-Title {
  param([string]$Title)
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
  Write-Host "  $Title" -ForegroundColor Blue
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
}

function Show-Help {
  Clear-Host
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
  Write-Host "  down      - 모든 환경 중지"
  Write-Host "  status    - 환경 상태 확인"
  Write-Host "  logs      - 로그 확인"
  Write-Host ""
  Write-Host "에이전트 로그인 (워크스페이스별 저장):" -ForegroundColor Yellow
  Write-Host "  login claude   - Claude 에이전트 로그인"
  Write-Host "  login codex    - Codex 에이전트 로그인"
  Write-Host "  login gemini   - Gemini 에이전트 로그인"
  Write-Host ""
  Write-Host "옵션 (모든 명령과 함께 사용 가능):" -ForegroundColor Yellow
  Write-Host "  --workspace=PATH   - 워크스페이스 경로 (로그인 정보 저장 위치)"
  Write-Host "  --instance=NAME    - 인스턴스 이름 (다중 인스턴스 스케일링)"
  Write-Host "  --web-port=PORT    - 웹 포트 (기본값: 환경별 다름)"
  Write-Host "  --redis-port=PORT  - Redis 포트 (기본값: 환경별 다름)"
  Write-Host ""
  Write-Host "예시:" -ForegroundColor Yellow
  Write-Host "  .\run.ps1 prod --workspace=D:\soulflow"
  Write-Host "  .\run.ps1 dev --instance=worker1 --web-port=4200"
  Write-Host "  .\run.ps1 dev --instance=worker2 --web-port=4201"
  Write-Host "  .\run.ps1 login claude --workspace=D:\soulflow"
  Write-Host ""
}

function Start-Environment {
  param(
    [string]$ProfileName,
    [string]$Port,
    [string]$RedisPort
  )

  Clear-Host
  Write-Host ""
  Write-Host "🚀 $ProfileName 환경 시작 중..." -ForegroundColor Yellow
  Write-Host "   워크스페이스: $Workspace"
  if ($Instance) { Write-Host "   인스턴스: $Instance" }
  Write-Host ""

  try {
    $env:WORKSPACE = $Workspace
    if ($WebPort) { $env:WEB_PORT = $WebPort }
    if ($RedisPort) { $env:REDIS_PORT = $RedisPort }
    if ($Instance) { $env:INSTANCE = $Instance }

    # Buildkit 비활성화 (Podman 권한 문제 우회)
    $env:DOCKER_BUILDKIT = 0

    $output = & node scripts/setup-environment.js $ProfileName 2>&1
    # [PROJECT_NAME:...] 패턴에서 프로젝트명 추출
    $projectName = ($output | Select-String '\[PROJECT_NAME:([^\]]+)\]').Matches.Groups[1].Value
    if (-not $projectName) { $projectName = "soulflow-$ProfileName" }

    $composeFile = "docker/docker-compose.$ProfileName.yml"
    docker compose -f $composeFile -p $projectName up -d

    Write-Host ""
    Write-Host "✅ $ProfileName 환경이 시작되었습니다!" -ForegroundColor Green
    Write-Host ""
  }
  catch {
    Write-Host "❌ 오류: $_" -ForegroundColor Red
  }
}

function Stop-AllEnvironments {
  Clear-Host
  Write-Host ""
  Write-Host "⛔ 모든 환경 중지 중..." -ForegroundColor Yellow
  Write-Host ""

  docker compose down -v 2>$null
  @("dev", "test", "staging", "prod") | ForEach-Object {
    docker compose -f "docker/docker-compose.$_.yml" down -v 2>$null
  }

  Write-Host ""
  Write-Host "✅ 모든 환경이 중지되었습니다" -ForegroundColor Green
  Write-Host ""
}

function Show-Status {
  Clear-Host
  Write-Host ""
  Write-Host "📊 환경 상태:" -ForegroundColor Blue
  Write-Host ""
  docker compose ps
  Write-Host ""
}

function Show-Logs {
  Clear-Host
  Write-Host ""
  Write-Host "📋 로그 확인 중... (Ctrl+C로 종료)" -ForegroundColor Blue
  Write-Host ""
  docker compose logs -f
}

function Start-AgentLogin {
  param([string]$Agent, [string]$WorkspacePath = "/data")

  Clear-Host
  Write-Host ""

  # 워크스페이스의 agents 디렉토리 생성
  $AgentsDir = "$WorkspacePath\.agents"
  if (-not (Test-Path $AgentsDir)) {
    New-Item -ItemType Directory -Path $AgentsDir -Force | Out-Null
  }

  switch ($Agent.ToLower()) {
    "claude" {
      Write-Host "🔑 Claude 에이전트 로그인 중..." -ForegroundColor Yellow
      Write-Host "   인증 정보 저장: $AgentsDir\.claude" -ForegroundColor Gray
      $claudeDir = "$AgentsDir\.claude"
      if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }
      docker run --rm -it -v "$claudeDir`:/root/.claude" soulflow-orchestrator claude login
    }
    "codex" {
      Write-Host "🔑 Codex 에이전트 로그인 중..." -ForegroundColor Yellow
      Write-Host "   인증 정보 저장: $AgentsDir\.codex" -ForegroundColor Gray
      $codexDir = "$AgentsDir\.codex"
      if (-not (Test-Path $codexDir)) { New-Item -ItemType Directory -Path $codexDir -Force | Out-Null }
      docker run --rm -it -p 1455:1456 -v "$codexDir`:/root/.codex" -v "$(Get-Location)\scripts\oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
    }
    "gemini" {
      Write-Host "🔑 Gemini 에이전트 로그인 중..." -ForegroundColor Yellow
      Write-Host "   인증 정보 저장: $AgentsDir\.gemini" -ForegroundColor Gray
      $geminiDir = "$AgentsDir\.gemini"
      if (-not (Test-Path $geminiDir)) { New-Item -ItemType Directory -Path $geminiDir -Force | Out-Null }
      docker run --rm -it -v "$geminiDir`:/root/.gemini" soulflow-orchestrator gemini auth login
    }
    default {
      Write-Host "❌ 알 수 없는 에이전트: $Agent" -ForegroundColor Red
      Write-Host "사용법: .\run.ps1 login [claude|codex|gemini]"
    }
  }
  Write-Host ""
}

# 메인 실행
switch -CaseSensitive ($Command.ToLower()) {
  "help" { Show-Help }
  "dev" { Start-Environment "dev" }
  "test" { Start-Environment "test" }
  "staging" { Start-Environment "staging" }
  "prod" { Start-Environment "prod" }
  "down" { Stop-AllEnvironments }
  "status" { Show-Status }
  "logs" { Show-Logs }
  "login" {
    $Agent = $Arguments[0]
    if ([string]::IsNullOrWhiteSpace($Agent)) {
      Write-Host "❌ 에이전트를 지정하세요" -ForegroundColor Red
      Write-Host "사용법: .\run.ps1 login [claude|codex|gemini]"
    } else {
      Start-AgentLogin $Agent $Workspace
    }
  }
  default {
    Write-Host "❌ 알 수 없는 명령어: $Command" -ForegroundColor Red
    Write-Host ""
    Show-Help
  }
}
