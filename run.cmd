@echo off
setlocal enabledelayedexpansion

REM SoulFlow Orchestrator 환경 관리 스크립트 (Windows CMD)
REM 사용법: run.cmd dev|test|staging|prod|down|status|logs|login|help
REM 예시: run.cmd dev --workspace=D:\soulflow

REM 색상 (Windows 10+)
set "BLUE=[94m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "NC=[0m"

REM Buildkit 비활성화 (Podman 권한 문제 우회)
set "DOCKER_BUILDKIT=0"

REM 파라미터 파싱
set "WORKSPACE="
set "WEB_PORT="
set "INSTANCE="

set "COMMAND=%~1"
if "%COMMAND%"=="" set "COMMAND=help"

REM 파라미터 파싱 (=구분, 공백구분 모두 지원)
set "PREV_KEY="
for %%a in (%*) do (
  set "arg=%%a"
  if defined PREV_KEY (
    if "!PREV_KEY!"=="workspace" set "WORKSPACE=!arg!"
    if "!PREV_KEY!"=="web-port" set "WEB_PORT=!arg!"
    if "!PREV_KEY!"=="instance" set "INSTANCE=!arg!"
    set "PREV_KEY="
  ) else (
    if "!arg:~0,12!"=="--workspace=" set "WORKSPACE=!arg:~12!"
    if "!arg!"=="--workspace" set "PREV_KEY=workspace"
    if "!arg:~0,11!"=="--web-port=" set "WEB_PORT=!arg:~11!"
    if "!arg!"=="--web-port" set "PREV_KEY=web-port"
    if "!arg:~0,10!"=="--webport=" set "WEB_PORT=!arg:~10!"
    if "!arg:~0,11!"=="--instance=" set "INSTANCE=!arg:~11!"
    if "!arg!"=="--instance" set "PREV_KEY=instance"
    if "!arg:~0,7!"=="--name=" set "INSTANCE=!arg:~7!"
    if "!arg!"=="--name" set "PREV_KEY=instance"
  )
)

if /i "%COMMAND%"=="help" goto help
if /i "%COMMAND%"=="dev" goto env_start
if /i "%COMMAND%"=="test" goto env_start
if /i "%COMMAND%"=="staging" goto env_start
if /i "%COMMAND%"=="prod" goto env_start
if /i "%COMMAND%"=="build" goto build
if /i "%COMMAND%"=="down" goto down
if /i "%COMMAND%"=="status" goto status
if /i "%COMMAND%"=="logs" goto logs
if /i "%COMMAND%"=="login" goto login

echo %RED%알 수 없는 명령: %COMMAND%%NC%
goto help

:env_start
if "%WORKSPACE%"=="" (
  echo %RED%--workspace 파라미터가 필요합니다.%NC%
  echo %YELLOW%예시: run.cmd %COMMAND% --workspace=D:\soulflow%NC%
  goto end
)

REM 프리셋 설정
if /i "%COMMAND%"=="dev" (
  set "BUILD_TARGET=dev"
  set "NODE_ENV=development"
  set "DEBUG=true"
  set "MEMORY=1G"
  set "CPUS=2"
  if "%WEB_PORT%"=="" set "WEB_PORT=4200"
)
if /i "%COMMAND%"=="test" (
  set "BUILD_TARGET=production"
  set "NODE_ENV=test"
  set "DEBUG=true"
  set "MEMORY=1G"
  set "CPUS=2"
  if "%WEB_PORT%"=="" set "WEB_PORT=4201"
)
if /i "%COMMAND%"=="staging" (
  set "BUILD_TARGET=production"
  set "NODE_ENV=production"
  set "DEBUG=false"
  set "MEMORY=1G"
  set "CPUS=2"
  if "%WEB_PORT%"=="" set "WEB_PORT=4202"
)
if /i "%COMMAND%"=="prod" (
  set "BUILD_TARGET=full"
  set "NODE_ENV=production"
  set "DEBUG=false"
  set "MEMORY=2G"
  set "CPUS=4"
  if "%WEB_PORT%"=="" set "WEB_PORT=4200"
)

REM 프로젝트명: soulflow-{profile}[-{instance}]
set "PROJECT_NAME=soulflow-%COMMAND%"
if not "%INSTANCE%"=="" set "PROJECT_NAME=!PROJECT_NAME!-!INSTANCE!"

set "HOST_WORKSPACE=%WORKSPACE%"

echo.
echo %YELLOW%🚀 %COMMAND% 환경 시작 중...%NC%
echo    워크스페이스: %WORKSPACE%
echo    프로젝트: !PROJECT_NAME!

REM .agents 디렉토리 사전 생성
if not exist "%WORKSPACE%\.agents\.claude" mkdir "%WORKSPACE%\.agents\.claude"
if not exist "%WORKSPACE%\.agents\.codex" mkdir "%WORKSPACE%\.agents\.codex"
if not exist "%WORKSPACE%\.agents\.gemini" mkdir "%WORKSPACE%\.agents\.gemini"

REM instance 모드: 기본 인프라(redis, docker-proxy) 먼저 보장
if not "%INSTANCE%"=="" (
  set "BASE_PROJECT=soulflow-%COMMAND%"
  set "PROJECT_NAME=!BASE_PROJECT!" && docker compose -f docker/docker-compose.yml -p !BASE_PROJECT! up -d redis docker-proxy 2>nul
  set "PROJECT_NAME=soulflow-%COMMAND%-!INSTANCE!"
)

REM compose 실행
set "COMPOSE_CMD=docker compose -f docker/docker-compose.yml"
if /i "%COMMAND%"=="dev" set "COMPOSE_CMD=!COMPOSE_CMD! -f docker/docker-compose.dev.override.yml"
if not "%INSTANCE%"=="" (
  set "BASE_PROFILE=%COMMAND%"
  set "COMPOSE_CMD=!COMPOSE_CMD! -f docker/docker-compose.instance.override.yml"
)
set "COMPOSE_CMD=!COMPOSE_CMD! -p !PROJECT_NAME! up -d --build"
!COMPOSE_CMD!

if !errorlevel! equ 0 (
  echo.
  echo %GREEN%✅ %COMMAND% 환경이 시작되었습니다!%NC%
  echo %GREEN%   프로젝트: !PROJECT_NAME!%NC%
  echo %GREEN%   웹 포트: !WEB_PORT!%NC%
) else (
  echo.
  echo %RED%환경 시작 실패%NC%
)
echo.
goto end

:build
echo.
echo %YELLOW%🔨 이미지 빌드 중...%NC%
docker compose -f docker/docker-compose.yml build
if !errorlevel! equ 0 (
  echo.
  echo %GREEN%✅ 이미지 빌드 완료%NC%
) else (
  echo.
  echo %RED%이미지 빌드 실패%NC%
)
echo.
goto end

:down
echo.
echo %YELLOW%모든 환경 중지 중...%NC%
docker compose -f docker/docker-compose.yml down -v 2>nul
echo.
echo %GREEN%✅ 모든 환경이 중지되었습니다%NC%
echo.
goto end

:status
echo.
echo %BLUE%환경 상태:%NC%
echo.
docker compose ps
goto end

:logs
echo.
echo %BLUE%로그 확인 중... (Ctrl+C로 종료)%NC%
echo.
docker compose logs -f
goto end

:login
if "%WORKSPACE%"=="" (
  echo %RED%--workspace 파라미터가 필요합니다.%NC%
  echo %YELLOW%예시: run.cmd login claude --workspace=D:\soulflow%NC%
  goto end
)

set "AGENTS_DIR=%WORKSPACE%\.agents"

if /i "%2"=="claude" (
  echo %YELLOW%🔑 Claude 에이전트 로그인 중...%NC%
  if not exist "!AGENTS_DIR!\.claude" mkdir "!AGENTS_DIR!\.claude"
  docker run --rm -it -v "!AGENTS_DIR!\.claude:/root/.claude" soulflow-orchestrator claude login
) else if /i "%2"=="codex" (
  echo %YELLOW%🔑 Codex 에이전트 로그인 중...%NC%
  if not exist "!AGENTS_DIR!\.codex" mkdir "!AGENTS_DIR!\.codex"
  docker run --rm -it -p 1455:1456 -v "!AGENTS_DIR!\.codex:/root/.codex" -v "%cd%\scripts\oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
) else if /i "%2"=="gemini" (
  echo %YELLOW%🔑 Gemini 에이전트 로그인 중...%NC%
  if not exist "!AGENTS_DIR!\.gemini" mkdir "!AGENTS_DIR!\.gemini"
  docker run --rm -it -v "!AGENTS_DIR!\.gemini:/root/.gemini" soulflow-orchestrator gemini auth login
) else (
  echo %RED%에이전트를 지정하세요%NC%
  echo 사용법: run.cmd login [claude^|codex^|gemini]
)
goto end

:help
echo.
echo %BLUE%════════════════════════════════════════%NC%
echo %BLUE%  SoulFlow Orchestrator 환경 관리%NC%
echo %BLUE%════════════════════════════════════════%NC%
echo.
echo %YELLOW%사용법:%NC%
echo   run.cmd [명령] [옵션]
echo.
echo %YELLOW%환경 시작:%NC%
echo   dev       - 개발 환경
echo   test      - 테스트 환경
echo   staging   - 스테이징 환경
echo   prod      - 프로덕션 환경
echo.
echo %YELLOW%관리:%NC%
echo   build     - 이미지 빌드
echo   down      - 모든 환경 중지
echo   status    - 환경 상태 확인
echo   logs      - 로그 확인
echo.
echo %YELLOW%에이전트 로그인:%NC%
echo   login claude   - Claude 에이전트 로그인
echo   login codex    - Codex 에이전트 로그인
echo   login gemini   - Gemini 에이전트 로그인
echo.
echo %YELLOW%옵션:%NC%
echo   --workspace=PATH   - 워크스페이스 경로 (필수)
echo   --instance=NAME    - 인스턴스 이름
echo   --web-port=PORT    - 웹 포트
echo.
goto end

:end
endlocal
