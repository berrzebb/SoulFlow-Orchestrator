#!/bin/bash

# SoulFlow Orchestrator 환경 관리 스크립트 (Linux/macOS)
# 사용법: ./run.sh dev|test|staging|prod|down|status|logs|help

set -e

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 파라미터 파싱 (named parameters 지원)
COMMAND=${1:-help}
WORKSPACE=/data
WEB_PORT=
REDIS_PORT=
INSTANCE=

shift || true
for arg in "$@"; do
  case $arg in
    --workspace=*)
      VAL="${arg#*=}"
      if [[ "$VAL" =~ ^= ]]; then
        echo -e "${RED}❌ 파라미터 오류: --workspace==... (= 기호가 두 개)${NC}"
        echo -e "${YELLOW}올바른 형식: --workspace=/path (= 한 개)${NC}"
        exit 1
      fi
      WORKSPACE="$VAL"
      ;;
    --web-port=* | --webport=*)
      WEB_PORT="${arg#*=}"
      ;;
    --redis-port=* | --redisport=*)
      REDIS_PORT="${arg#*=}"
      ;;
    --instance=* | --name=*)
      INSTANCE="${arg#*=}"
      ;;
  esac
done

show_help() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}  SoulFlow Orchestrator 환경 관리${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}사용법:${NC}"
  echo "  ./run.sh [명령] [옵션]"
  echo ""
  echo -e "${YELLOW}환경 시작:${NC}"
  echo "  dev       - 개발 환경"
  echo "  test      - 테스트 환경"
  echo "  staging   - 스테이징 환경"
  echo "  prod      - 프로덕션 환경"
  echo ""
  echo -e "${YELLOW}관리:${NC}"
  echo "  down      - 모든 환경 중지"
  echo "  status    - 환경 상태 확인"
  echo "  logs      - 로그 확인"
  echo ""
  echo -e "${YELLOW}에이전트 로그인 (워크스페이스별 저장):${NC}"
  echo "  login claude   - Claude 에이전트 로그인"
  echo "  login codex    - Codex 에이전트 로그인"
  echo "  login gemini   - Gemini 에이전트 로그인"
  echo ""
  echo -e "${YELLOW}옵션 (모든 명령과 함께 사용 가능):${NC}"
  echo "  --workspace=PATH   - 워크스페이스 경로 (로그인 정보 저장 위치)"
  echo "  --instance=NAME    - 인스턴스 이름 (다중 인스턴스 스케일링)"
  echo "  --web-port=PORT    - 웹 포트 (기본값: 환경별 다름)"
  echo "  --redis-port=PORT  - Redis 포트 (기본값: 환경별 다름)"
  echo ""
  echo -e "${YELLOW}예시:${NC}"
  echo "  ./run.sh dev"
  echo "  ./run.sh dev --instance=worker1 --web-port=4200"
  echo "  ./run.sh dev --instance=worker2 --web-port=4201"
  echo "  ./run.sh login claude --workspace=/custom/path"
  echo ""
}

run_env() {
  local profile=$1
  echo -e "\n${YELLOW}🚀 $profile 환경 시작 중...${NC}"
  echo "   워크스페이스: $WORKSPACE"
  [ -n "$INSTANCE" ] && echo "   인스턴스: $INSTANCE"
  [ -n "$WEB_PORT" ] && echo "   웹 포트: $WEB_PORT"
  [ -n "$REDIS_PORT" ] && echo "   Redis 포트: $REDIS_PORT"

  export WORKSPACE="$WORKSPACE"
  [ -n "$WEB_PORT" ] && export WEB_PORT="$WEB_PORT"
  [ -n "$REDIS_PORT" ] && export REDIS_PORT="$REDIS_PORT"
  [ -n "$INSTANCE" ] && export INSTANCE="$INSTANCE"

  # Buildkit 비활성화 (Podman 권한 문제 우회)
  export DOCKER_BUILDKIT=0

  output=$(node scripts/setup-environment.js "$profile" 2>&1)
  # [PROJECT_NAME:...] 패턴에서 프로젝트명 추출
  project_name=$(echo "$output" | grep -oP '\[PROJECT_NAME:\K[^\]]+' || echo "soulflow-$profile")

  docker compose -f "docker/docker-compose.${profile}.yml" -p "$project_name" up -d

  echo -e "\n${GREEN}✅ $profile 환경이 시작되었습니다!${NC}"
}

case "$COMMAND" in
  dev)
    run_env "dev"
    ;;
  test)
    run_env "test"
    ;;
  staging)
    run_env "staging"
    ;;
  prod)
    run_env "prod"
    ;;
  down)
    echo -e "\n${YELLOW}⛔ 모든 환경 중지 중...${NC}"
    docker compose down -v 2>/dev/null || true
    for profile in dev test staging prod; do
      docker compose -f "docker/docker-compose.${profile}.yml" down -v 2>/dev/null || true
    done
    echo -e "${GREEN}✅ 모든 환경이 중지되었습니다${NC}\n"
    ;;
  status)
    echo -e "\n${BLUE}📊 환경 상태:${NC}"
    docker compose ps 2>/dev/null || echo "실행 중인 환경 없음"
    ;;
  logs)
    echo -e "\n${BLUE}📋 로그 확인 중... (Ctrl+C로 종료)${NC}"
    docker compose logs -f
    ;;
  login)
    AGENT=${2:-}
    AGENTS_DIR="$WORKSPACE/.agents"
    mkdir -p "$AGENTS_DIR"

    case "$AGENT" in
      claude)
        echo -e "\n${YELLOW}🔑 Claude 에이전트 로그인 중...${NC}"
        echo -e "${GRAY}   인증 정보 저장: $AGENTS_DIR/.claude${NC}"
        mkdir -p "$AGENTS_DIR/.claude"
        docker run --rm -it -v "$AGENTS_DIR/.claude:/root/.claude" soulflow-orchestrator claude login
        ;;
      codex)
        echo -e "\n${YELLOW}🔑 Codex 에이전트 로그인 중...${NC}"
        echo -e "${GRAY}   인증 정보 저장: $AGENTS_DIR/.codex${NC}"
        mkdir -p "$AGENTS_DIR/.codex"
        docker run --rm -it -p 1455:1456 -v "$AGENTS_DIR/.codex:/root/.codex" -v "$(pwd)/scripts/oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
        ;;
      gemini)
        echo -e "\n${YELLOW}🔑 Gemini 에이전트 로그인 중...${NC}"
        echo -e "${GRAY}   인증 정보 저장: $AGENTS_DIR/.gemini${NC}"
        mkdir -p "$AGENTS_DIR/.gemini"
        docker run --rm -it -v "$AGENTS_DIR/.gemini:/root/.gemini" soulflow-orchestrator gemini auth login
        ;;
      *)
        echo "알 수 없는 에이전트: $AGENT"
        echo "사용법: ./run.sh login [claude|codex|gemini]"
        exit 1
        ;;
    esac
    ;;
  help)
    show_help
    ;;
  *)
    echo "알 수 없는 명령: $COMMAND"
    show_help
    exit 1
    ;;
esac
