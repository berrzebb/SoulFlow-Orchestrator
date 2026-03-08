@echo off
setlocal enabledelayedexpansion

REM SoulFlow Orchestrator 환경 관리 스크립트 (Windows)
REM 사용법: run.cmd dev [workspace] [web_port] [redis_port]

setlocal enabledelayedexpansion

REM Buildkit 비활성화 (Podman 권한 문제 우회)
set "DOCKER_BUILDKIT=0"

REM 파라미터 파싱 (named parameters 지원)
set "WORKSPACE=/data"
set "WEB_PORT="
set "REDIS_PORT="
set "INSTANCE="

REM 모든 인자를 파싱
setlocal enabledelayedexpansion
for /l %%i in (2, 1, 9) do (
  set "arg=!%%i!"
  if not "!arg!"=="" (
    if "!arg:~0,12!"=="--workspace=" (
      set "VAL=!arg:~12!"
      if "!VAL:~0,1!"=="=" (
        echo %YELLOW%❌ 파라미터 오류: --workspace==... (= 기호가 두 개)%RESET%
        echo %YELLOW%올바른 형식: --workspace=D:\path (= 한 개)%RESET%
        exit /b 1
      )
      set "WORKSPACE=!VAL!"
    ) else if "!arg:~0,10!"=="--webport=" (
      set "WEB_PORT=!arg:~10!"
    ) else if "!arg:~0,11!"=="--web-port=" (
      set "WEB_PORT=!arg:~11!"
    ) else if "!arg:~0,12!"=="--redisport=" (
      set "REDIS_PORT=!arg:~12!"
    ) else if "!arg:~0,13!"=="--redis-port=" (
      set "REDIS_PORT=!arg:~13!"
    ) else if "!arg:~0,11!"=="--instance=" (
      set "INSTANCE=!arg:~11!"
    ) else if "!arg:~0,7!"=="--name=" (
      set "INSTANCE=!arg:~7!"
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
if /i "%1"=="login" goto login

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
echo   run.cmd [명령] [옵션]
echo.
echo %YELLOW%환경 시작:%RESET%
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
echo %YELLOW%에이전트 로그인 (워크스페이스별 저장):%RESET%
echo   login claude   - Claude 에이전트 로그인
echo   login codex    - Codex 에이전트 로그인
echo   login gemini   - Gemini 에이전트 로그인
echo.
echo %YELLOW%옵션 (모든 명령과 함께 사용 가능):%RESET%
echo   --workspace=PATH   - 워크스페이스 경로 (로그인 정보 저장 위치)
echo   --instance=NAME    - 인스턴스 이름 (다중 인스턴스 스케일링)
echo   --web-port=PORT    - 웹 포트 (기본값: 환경별 다름)
echo   --redis-port=PORT  - Redis 포트 (기본값: 환경별 다름)
echo.
echo %YELLOW%예시:%RESET%
echo   run.cmd dev
echo   run.cmd dev --instance=worker1 --web-port=4200
echo   run.cmd dev --instance=worker2 --web-port=4201
echo   run.cmd login claude --workspace=D:\soulflow
echo.
goto end

:dev
cls
echo.
echo %YELLOW%🚀 개발 환경 시작 중...%RESET%
echo.
set "WORKSPACE=!WORKSPACE!"
if not "!INSTANCE!"=="" set "INSTANCE=!INSTANCE!"
if not "!WEB_PORT!"=="" set "WEB_PORT=!WEB_PORT!"
if not "!REDIS_PORT!"=="" set "REDIS_PORT=!REDIS_PORT!"
node scripts/setup-environment.js dev > nul
if !errorlevel! neq 0 goto error
for /f "tokens=*" %%i in ('node scripts/setup-environment.js dev 2^>nul ^| findstr /R "\[PROJECT_NAME:"') do set "PROJECT_NAME=%%i"
set "PROJECT_NAME=!PROJECT_NAME:[PROJECT_NAME:=!"
set "PROJECT_NAME=!PROJECT_NAME:]=!"
docker compose -f docker/docker-compose.dev.yml -p !PROJECT_NAME! up -d
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
if not "!INSTANCE!"=="" set "INSTANCE=!INSTANCE!"
if not "!WEB_PORT!"=="" set "WEB_PORT=!WEB_PORT!"
if not "!REDIS_PORT!"=="" set "REDIS_PORT=!REDIS_PORT!"
node scripts/setup-environment.js test > nul
if !errorlevel! neq 0 goto error
for /f "tokens=*" %%i in ('node scripts/setup-environment.js test 2^>nul ^| findstr /R "\[PROJECT_NAME:"') do set "PROJECT_NAME=%%i"
set "PROJECT_NAME=!PROJECT_NAME:[PROJECT_NAME:=!"
set "PROJECT_NAME=!PROJECT_NAME:]=!"
docker compose -f docker/docker-compose.test.yml -p !PROJECT_NAME! up -d
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
if not "!INSTANCE!"=="" set "INSTANCE=!INSTANCE!"
if not "!WEB_PORT!"=="" set "WEB_PORT=!WEB_PORT!"
if not "!REDIS_PORT!"=="" set "REDIS_PORT=!REDIS_PORT!"
node scripts/setup-environment.js staging > nul
if !errorlevel! neq 0 goto error
for /f "tokens=*" %%i in ('node scripts/setup-environment.js staging 2^>nul ^| findstr /R "\[PROJECT_NAME:"') do set "PROJECT_NAME=%%i"
set "PROJECT_NAME=!PROJECT_NAME:[PROJECT_NAME:=!"
set "PROJECT_NAME=!PROJECT_NAME:]=!"
docker compose -f docker/docker-compose.staging.yml -p !PROJECT_NAME! up -d
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
if not "!INSTANCE!"=="" set "INSTANCE=!INSTANCE!"
if not "!WEB_PORT!"=="" set "WEB_PORT=!WEB_PORT!"
if not "!REDIS_PORT!"=="" set "REDIS_PORT=!REDIS_PORT!"
node scripts/setup-environment.js prod > nul
if !errorlevel! neq 0 goto error
for /f "tokens=*" %%i in ('node scripts/setup-environment.js prod 2^>nul ^| findstr /R "\[PROJECT_NAME:"') do set "PROJECT_NAME=%%i"
set "PROJECT_NAME=!PROJECT_NAME:[PROJECT_NAME:=!"
set "PROJECT_NAME=!PROJECT_NAME:]=!"
docker compose -f docker/docker-compose.prod.yml -p !PROJECT_NAME! up -d
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
for %%p in (dev test staging prod) do (
  docker compose -f docker/docker-compose.%%p.yml down -v 2>nul
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

:login
cls
echo.
set "AGENTS_DIR=%WORKSPACE%\.agents"
if not exist "!AGENTS_DIR!" mkdir "!AGENTS_DIR!"

if /i "%2"=="claude" (
  echo %YELLOW%🔑 Claude 에이전트 로그인 중...%RESET%
  echo %YELLOW%   인증 정보 저장: !AGENTS_DIR!\claude%RESET%
  if not exist "!AGENTS_DIR!\claude" mkdir "!AGENTS_DIR!\claude"
  docker run --rm -it -v "!AGENTS_DIR!\claude:/root/.claude" soulflow-orchestrator claude login
) else if /i "%2"=="codex" (
  echo %YELLOW%🔑 Codex 에이전트 로그인 중...%RESET%
  echo %YELLOW%   인증 정보 저장: !AGENTS_DIR!\codex%RESET%
  if not exist "!AGENTS_DIR!\codex" mkdir "!AGENTS_DIR!\codex"
  docker run --rm -it -p 1455:1456 -v "!AGENTS_DIR!\codex:/root/.codex" -v "%cd%\scripts\oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
) else if /i "%2"=="gemini" (
  echo %YELLOW%🔑 Gemini 에이전트 로그인 중...%RESET%
  echo %YELLOW%   인증 정보 저장: !AGENTS_DIR!\gemini%RESET%
  if not exist "!AGENTS_DIR!\gemini" mkdir "!AGENTS_DIR!\gemini"
  docker run --rm -it -v "!AGENTS_DIR!\gemini:/root/.gemini" soulflow-orchestrator gemini auth login
) else (
  echo %BLUE%❌ 알 수 없는 에이전트: %2%RESET%
  echo 사용법: run.cmd login [claude^|codex^|gemini]
  goto end
)
goto end

:error
echo.
echo %BLUE%❌ 오류가 발생했습니다%RESET%
echo.
goto end

:end
endlocal
