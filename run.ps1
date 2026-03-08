# SoulFlow Orchestrator 환경 관리 스크립트 (Windows PowerShell)
# 사용법: .\run.ps1 dev|test|staging|prod|down|status|logs|help
# 워크스페이스: $env:WORKSPACE="D:\custom\path" .\run.ps1 dev

param(
  [Parameter(Position = 0)]
  [string]$Command = "help"
)

$ErrorActionPreference = "Continue"
$Workspace = $env:WORKSPACE -or "/data"

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
  Write-Host "환경 시작:" -ForegroundColor Yellow
  Write-Host "  .\run.ps1 dev       - 개발 환경 시작"
  Write-Host "  .\run.ps1 test      - 테스트 환경 시작"
  Write-Host "  .\run.ps1 staging   - 스테이징 환경 시작"
  Write-Host "  .\run.ps1 prod      - 프로덕션 환경 시작"
  Write-Host ""
  Write-Host "관리:" -ForegroundColor Yellow
  Write-Host "  .\run.ps1 down      - 모든 환경 중지"
  Write-Host "  .\run.ps1 status    - 환경 상태 확인"
  Write-Host "  .\run.ps1 logs      - 로그 확인"
  Write-Host ""
  Write-Host "옵션:" -ForegroundColor Yellow
  Write-Host "  `$env:WORKSPACE='D:\path' .\run.ps1 dev - 커스텀 워크스페이스"
  Write-Host ""
}

function Start-Environment {
  param(
    [string]$Profile,
    [string]$Port,
    [string]$RedisPort
  )

  Clear-Host
  Write-Host ""
  Write-Host "🚀 $Profile 환경 시작 중..." -ForegroundColor Yellow
  Write-Host "   워크스페이스: $Workspace"
  Write-Host ""

  try {
    $env:WORKSPACE = $Workspace
    & node setup-environment.js $Profile
    $composeFile = "docker-compose.$Profile.yml"
    docker compose -f $composeFile up -d

    Write-Host ""
    Write-Host "✅ $Profile 환경이 시작되었습니다!" -ForegroundColor Green
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
  @("dev", "test", "staging") | ForEach-Object {
    docker compose -f "docker-compose.$_.yml" down -v 2>$null
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

# 메인 실행
switch -CaseSensitive ($Command.ToLower()) {
  "help" { Show-Help }
  "dev" { Start-Environment "dev" "4200" "6379" }
  "test" { Start-Environment "test" "4201" "6380" }
  "staging" { Start-Environment "staging" "4202" "6381" }
  "prod" { Start-Environment "prod" "4200" "6379" }
  "down" { Stop-AllEnvironments }
  "status" { Show-Status }
  "logs" { Show-Logs }
  default {
    Write-Host "❌ 알 수 없는 명령어: $Command" -ForegroundColor Red
    Write-Host ""
    Show-Help
  }
}
