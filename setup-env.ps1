# SoulFlow 환경 관리 스크립트 (Windows PowerShell)
# 사용법: .\setup-env.ps1

$ErrorActionPreference = "Stop"

function Write-Title {
  param([string]$Title)
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
  Write-Host "  $Title" -ForegroundColor Blue
  Write-Host "════════════════════════════════════════" -ForegroundColor Blue
}

function Show-Menu {
  Write-Host ""
  Write-Title "SoulFlow Orchestrator 환경 관리"
  Write-Host ""
  Write-Host "1) 개발 환경 (Development) - 포트 4200"
  Write-Host "2) 테스트 환경 (Test) - 포트 4201"
  Write-Host "3) 스테이징 환경 (Staging) - 포트 4202"
  Write-Host "4) 프로덕션 환경 (Production) - 포트 4200"
  Write-Host ""
  Write-Host "5) 환경 상태 확인"
  Write-Host "6) 로그 확인"
  Write-Host "7) 모든 환경 중지"
  Write-Host "8) 종료"
  Write-Host ""
  Write-Host "선택하세요 (1-8): " -NoNewline
}

function Setup-Environment {
  param([string]$Profile)

  Write-Host ""
  Write-Host "⚙️  설정 생성 중..." -ForegroundColor Yellow

  try {
    & node setup-environment.js $Profile

    $composeFile = "docker-compose.$Profile.yml"
    Write-Host ""
    Write-Host "🚀 환경 시작 중..." -ForegroundColor Yellow

    docker compose -f $composeFile up -d

    Start-Sleep -Seconds 3
    docker compose -f $composeFile ps

    Write-Host ""
    Write-Host "✅ $Profile 환경이 시작되었습니다!" -ForegroundColor Green
  }
  catch {
    Write-Host "❌ 오류 발생: $_" -ForegroundColor Red
  }
}

function Show-Status {
  Write-Host ""
  Write-Host "📊 환경 상태:" -ForegroundColor Blue
  Write-Host ""

  @("dev", "test", "staging") | ForEach-Object {
    $profile = $_
    $file = "docker-compose.$profile.yml"

    if (Test-Path $file) {
      Write-Host "$($profile.ToUpper()):" -ForegroundColor Yellow

      try {
        docker compose -f $file ps 2>$null | Write-Host
      }
      catch {
        Write-Host "  (실행 중이 아님)"
      }
      Write-Host ""
    }
  }
}

function Show-Logs {
  Write-Host ""
  Write-Host "어떤 환경의 로그를 보시겠습니까?" -ForegroundColor Yellow
  Write-Host "1) 개발 (dev)"
  Write-Host "2) 테스트 (test)"
  Write-Host "3) 스테이징 (staging)"
  Write-Host "4) 뒤로 가기"
  Write-Host ""
  Write-Host "선택하세요 (1-4): " -NoNewline

  $choice = Read-Host

  switch ($choice) {
    "1" { docker compose -f docker-compose.dev.yml logs -f }
    "2" { docker compose -f docker-compose.test.yml logs -f }
    "3" { docker compose -f docker-compose.staging.yml logs -f }
    "4" { return }
    default {
      Write-Host "❌ 잘못된 선택" -ForegroundColor Red
      Show-Logs
    }
  }
}

function Stop-AllEnvironments {
  Write-Host ""
  Write-Host "모든 환경을 중지하시겠습니까? (y/n): " -ForegroundColor Yellow -NoNewline

  $confirm = Read-Host

  if ($confirm -eq "y" -or $confirm -eq "Y") {
    @("dev", "test", "staging") | ForEach-Object {
      $profile = $_
      $file = "docker-compose.$profile.yml"

      if (Test-Path $file) {
        Write-Host "$profile 환경 중지 중..." -ForegroundColor Yellow
        docker compose -f $file down -ErrorAction SilentlyContinue
      }
    }

    Write-Host "✅ 모든 환경이 중지되었습니다" -ForegroundColor Green
  }
}

# 메인 루프
$continue = $true

while ($continue) {
  Clear-Host
  Show-Menu

  $choice = Read-Host

  switch ($choice) {
    "1" { Setup-Environment "dev" }
    "2" { Setup-Environment "test" }
    "3" { Setup-Environment "staging" }
    "4" { Setup-Environment "prod" }
    "5" { Show-Status }
    "6" { Show-Logs }
    "7" { Stop-AllEnvironments }
    "8" {
      Write-Host ""
      Write-Host "👋 종료합니다" -ForegroundColor Green
      Write-Host ""
      $continue = $false
    }
    default {
      Write-Host "❌ 잘못된 선택. 다시 시도하세요" -ForegroundColor Red
    }
  }

  if ($continue) {
    Write-Host ""
    Write-Host "[Enter를 눌러 계속]" -ForegroundColor Yellow
    Read-Host | Out-Null
  }
}
