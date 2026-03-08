@echo off
setlocal enabledelayedexpansion

REM SoulFlow Orchestrator 환경 관리 스크립트 (Windows)
REM 사용법: run.cmd dev|test|staging|prod|down|status|logs|help
REM 워크스페이스: run.cmd dev WORKSPACE=D:\my\workspace

setlocal enabledelayedexpansion

REM 환경변수 설정 (WORKSPACE=xxx 형태로 전달받음)
if not "!WORKSPACE!"=="" (
  set "WORKSPACE=!WORKSPACE!"
) else (
  REM .env 파일에서 WORKSPACE 읽기
  for /f "tokens=2 delims==" %%A in ('findstr /R "^WORKSPACE=" .env 2^>nul') do (
    set "WORKSPACE=%%A"
  )
)

REM 기본값
if "!WORKSPACE!"=="" set "WORKSPACE=/data"

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
if /i "%1"=="clean" goto clean
if /i "%1"=="build" goto build
if /i "%1"=="test-unit" goto test-unit
if /i "%1"=="lint" goto lint
if /i "%1"=="quality" goto quality

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
echo %YELLOW%환경 시작:%RESET%
echo   run.cmd dev       - 개발 환경 시작 (포트 4200, 자동 리로드)
echo   run.cmd test      - 테스트 환경 시작 (포트 4201)
echo   run.cmd staging   - 스테이징 환경 시작 (포트 4202)
echo   run.cmd prod      - 프로덕션 환경 시작 (포트 4200)
echo.
echo %YELLOW%관리:%RESET%
echo   run.cmd down      - 모든 환경 중지 및 정리
echo   run.cmd status    - 환경 상태 확인
echo   run.cmd logs      - 로그 확인
echo   run.cmd clean     - 완전 정리 (이미지, 볼륨 포함)
echo.
echo %YELLOW%개발:%RESET%
echo   run.cmd build     - 타입스크립트 빌드
echo   run.cmd test-unit - 유닛 테스트 실행
echo   run.cmd lint      - 코드 린트 검사
echo   run.cmd quality   - 전체 품질 검사 (build+lint+test)
echo.
echo %YELLOW%예시:%RESET%
echo   run.cmd dev       - 개발 환경 시작
echo   run.cmd status    - 상태 확인
echo   run.cmd logs      - 로그 보기
echo.
goto end

:dev
cls
echo.
echo %YELLOW%🚀 개발 환경 시작 중...%RESET%
echo.
node setup-environment.js dev
if !errorlevel! neq 0 goto error
docker compose -f docker-compose.dev.yml up -d
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 개발 환경이 시작되었습니다!%RESET%
echo    웹: http://localhost:4200
echo    Redis: redis://localhost:6379
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
echo    웹: http://localhost:4201
echo    Redis: redis://localhost:6380
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
echo    웹: http://localhost:4202
echo    Redis: redis://localhost:6381
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
echo    웹: http://localhost:4200
echo    Redis: redis://localhost:6379
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

:clean
cls
echo.
echo %YELLOW%🧹 완전 정리 중...%RESET%
echo.
docker compose down -v 2>nul
for %%p in (dev test staging) do (
  docker compose -f docker-compose.%%p.yml down -v 2>nul
)
docker image prune -a -f 2>nul
docker volume prune -f 2>nul
docker network prune -f 2>nul
echo.
echo %GREEN%✅ 완전 정리 완료%RESET%
echo.
goto end

:build
cls
echo.
echo %YELLOW%🔨 타입스크립트 빌드 중...%RESET%
echo.
npm run build
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 빌드 완료%RESET%
echo.
goto end

:test-unit
cls
echo.
echo %YELLOW%🧪 유닛 테스트 실행 중...%RESET%
echo.
npm test
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 테스트 통과%RESET%
echo.
goto end

:lint
cls
echo.
echo %YELLOW%🔍 코드 린트 검사 중...%RESET%
echo.
npm run lint
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 린트 검사 통과%RESET%
echo.
goto end

:quality
cls
echo.
echo %YELLOW%🔍 전체 품질 검사 중...%RESET%
echo.
npm run quality
if !errorlevel! neq 0 goto error
echo.
echo %GREEN%✅ 모든 품질 검사 통과!%RESET%
echo.
goto end

:error
echo.
echo %BLUE%❌ 오류가 발생했습니다%RESET%
echo.
goto end

:end
endlocal
