@echo off
setlocal enabledelayedexpansion

REM SoulFlow Orchestrator 환경 관리 스크립트 (Windows)
REM 사용법: run.cmd dev [workspace] [web_port] [redis_port]

setlocal enabledelayedexpansion

REM 파라미터 파싱 (named parameters 지원)
set "WORKSPACE=/data"
set "WEB_PORT="
set "REDIS_PORT="

REM 모든 인자를 파싱
setlocal enabledelayedexpansion
for /l %%i in (2, 1, 9) do (
  set "arg=!%%i!"
  if not "!arg!"=="" (
    if "!arg:~0,12!"=="--workspace=" (
      set "WORKSPACE=!arg:~12!"
    ) else if "!arg:~0,11!"=="--web-port=" (
      set "WEB_PORT=!arg:~11!"
    ) else if "!arg:~0,13!"=="--redis-port=" (
      set "REDIS_PORT=!arg:~13!"
    )
  )
)

cls

REM 색상 정의 (Windows 10+)
set "BLUE=[94m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "RESET=[0m"

if "%1"=="" goto help
if /i "%1"=="help" goto help
if /i "%1"=="dev" goto dev
if /i "%1"=="test" goto test
if /i "%1"=="staging" goto staging
if /i "%1"=="prod" goto prod
if /i "%1"=="down" goto down
if /i "%1"=="status" goto status
if /i "%1"=="logs" goto logs

echo Unknown command: %1
goto help

:help
cls
echo.
echo.
echo %BLUE%════════════════════════════════════════%RESET%
echo %BLUE%   SoulFlow Orchestrator 환경 관리%RESET%
echo %BLUE%════════════════════════════════════════%RESET%
echo.
echo %YELLOW%사용법:%RESET%
echo   run.cmd dev [--workspace=PATH] [--web-port=PORT] [--redis-port=PORT]
echo.
echo %YELLOW%환경:%RESET%
echo   dev       - 개발 환경
echo   test      - 테스트 환경
echo   staging   - 스테이징 환경
echo   prod      - 프로덕션 환경
echo.
echo %YELLOW%관리:%RESET%
echo   down      - 모든 환경 중지
echo   status    - 환경 상태 확인
echo   logs      - 로그 확인
echo.
echo %YELLOW%예시:%RESET%
echo   run.cmd dev
echo   run.cmd dev --workspace=D:\path
echo   run.cmd dev --workspace=D:\path --web-port=8080 --redis-port=6380
echo.
goto end

:dev
cls
echo.
echo %YELLOW%🚀 개발 환경 시작 중...%RESET%
echo.
set "WORKSPACE=!WORKSPACE!"
if not "!WEB_PORT!"=="" set "WEB_PORT=!WEB_PORT!"
if not "!REDIS_PORT!"=="" set "REDIS_PORT=!REDIS_PORT!"
node setup-environment.js dev
if !errorlevel! neq 0 goto error
docker compose -f docker-compose.dev.yml up -d
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 개발 환경이 시작되었습니다!%RESET%
echo.
goto end

:test
cls
echo.
echo %YELLOW%🧪 테스트 환경 시작 중...%RESET%
echo.
node setup-environment.js test
if !errorlevel! neq 0 goto error
docker compose -f docker-compose.test.yml up -d
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 테스트 환경이 시작되었습니다!%RESET%
echo.
goto end

:staging
cls
echo.
echo %YELLOW%📦 스테이징 환경 시작 중...%RESET%
echo.
node setup-environment.js staging
if !errorlevel! neq 0 goto error
docker compose -f docker-compose.staging.yml up -d
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 스테이징 환경이 시작되었습니다!%RESET%
echo.
goto end

:prod
cls
echo.
echo %YELLOW%🏢 프로덕션 환경 시작 중...%RESET%
echo.
node setup-environment.js prod
if !errorlevel! neq 0 goto error
docker compose -f docker-compose.yml up -d
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 프로덕션 환경이 시작되었습니다!%RESET%
echo.
goto end

:down
cls
echo.
echo %YELLOW%⛔ 모든 환경 중지 중...%RESET%
echo.
docker compose down -v 2>nul
for %%p in (dev test staging) do (
  docker compose -f docker-compose.%%p.yml down -v 2>nul
)
echo.
echo %GREEN%✅ 모든 환경이 중지되었습니다%RESET%
echo.
goto end

:status
cls
echo.
echo %BLUE%📊 환경 상태:%RESET%
echo.
docker compose ps
goto end

:logs
cls
echo.
echo %BLUE%📋 로그 확인 중... (Ctrl+C로 종료)%RESET%
echo.
docker compose logs -f
goto end

:error
echo.
echo %BLUE%❌ 오류가 발생했습니다%RESET%
echo.
goto end

:end
endlocal
