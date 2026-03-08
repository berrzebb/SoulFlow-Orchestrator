#!/bin/bash

# SoulFlow Orchestrator 환경 관리 스크립트 (Linux/macOS)
# 사용법: ./run.sh dev|test|staging|prod|down|status|logs|login|help
# 예시: ./run.sh dev --workspace=/home/user/soulflow

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 파라미터 파싱
COMMAND=${1:-help}
WORKSPACE=
WEB_PORT=
REDIS_PORT=
INSTANCE=

shift || true
while [ $# -gt 0 ]; do
  case $1 in
    --workspace=*)
      VAL="${1#*=}"
      if [[ "$VAL" =~ ^= ]]; then
        echo -e "${RED}파라미터 오류: --workspace==... (= 기호가 두 개)${NC}"
        echo -e "${YELLOW}올바른 형식: --workspace=/path (= 한 개)${NC}"
        exit 1
      fi
      WORKSPACE="$VAL"
      ;;
    --workspace) shift; WORKSPACE="$1" ;;
    --web-port=* | --webport=*) WEB_PORT="${1#*=}" ;;
    --web-port | --webport) shift; WEB_PORT="$1" ;;
    --redis-port=* | --redisport=*) REDIS_PORT="${1#*=}" ;;
    --redis-port | --redisport) shift; REDIS_PORT="$1" ;;
    --instance=* | --name=*) INSTANCE="${1#*=}" ;;
    --instance | --name) shift; INSTANCE="$1" ;;
  esac
  shift
done

# 환경별 프리셋
get_preset() {
  local profile=$1
  case $profile in
    dev)     BUILD_TARGET=dev;        NODE_ENV=development; DEBUG=true;  MEMORY=1G; CPUS=2; DEFAULT_WEB_PORT=4200; DEFAULT_REDIS_PORT=6379 ;;
    test)    BUILD_TARGET=production; NODE_ENV=test;        DEBUG=true;  MEMORY=1G; CPUS=2; DEFAULT_WEB_PORT=4201; DEFAULT_REDIS_PORT=6380 ;;
    staging) BUILD_TARGET=production; NODE_ENV=production;  DEBUG=false; MEMORY=1G; CPUS=2; DEFAULT_WEB_PORT=4202; DEFAULT_REDIS_PORT=6381 ;;
    prod)    BUILD_TARGET=full;       NODE_ENV=production;  DEBUG=false; MEMORY=2G; CPUS=4; DEFAULT_WEB_PORT=4200; DEFAULT_REDIS_PORT=6379 ;;
    *) echo -e "${RED}알 수 없는 프로필: $profile${NC}"; exit 1 ;;
  esac
}

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
  echo "  --workspace=PATH   - 워크스페이스 경로 (필수)"
  echo "  --instance=NAME    - 인스턴스 이름 (다중 인스턴스 스케일링)"
  echo "  --web-port=PORT    - 웹 포트 (기본값: 환경별 다름)"
  echo "  --redis-port=PORT  - Redis 포트 (기본값: 환경별 다름)"
  echo ""
  echo -e "${YELLOW}예시:${NC}"
  echo "  ./run.sh dev --workspace=/home/user/soulflow"
  echo "  ./run.sh dev --workspace=/home/user/soulflow --instance=worker1 --web-port=4200"
  echo "  ./run.sh login claude --workspace=/home/user/soulflow"
  echo ""
}

run_env() {
  local profile=$1

  if [ -z "$WORKSPACE" ]; then
    echo -e "${RED}--workspace 파라미터가 필요합니다.${NC}"
    echo -e "${YELLOW}예시: ./run.sh $profile --workspace=/path/to/workspace${NC}"
    exit 1
  fi

  get_preset "$profile"

  # 프로젝트명: soulflow-{profile}[-{instance}]
  local project_name="soulflow-$profile"
  [ -n "$INSTANCE" ] && project_name="$project_name-$INSTANCE"

  echo -e "\n${YELLOW}🚀 $profile 환경 시작 중...${NC}"
  echo "   워크스페이스: $WORKSPACE"
  echo "   프로젝트: $project_name"
  [ -n "$INSTANCE" ] && echo "   인스턴스: $INSTANCE"

  # .agents 디렉토리 사전 생성 (볼륨 마운트 요구사항)
  for agent in .claude .codex .gemini; do
    mkdir -p "$WORKSPACE/.agents/$agent"
  done

  # 프리셋 → 환경변수
  export DOCKER_BUILDKIT=0
  export BUILD_TARGET
  export NODE_ENV
  export DEBUG
  export MEMORY
  export CPUS
  export HOST_WORKSPACE="$WORKSPACE"
  export PROJECT_NAME="$project_name"
  export WEB_PORT="${WEB_PORT:-$DEFAULT_WEB_PORT}"
  export REDIS_PORT="${REDIS_PORT:-$DEFAULT_REDIS_PORT}"

  # compose 실행
  local compose_args=("-f" "docker/docker-compose.yml")
  if [ "$profile" = "dev" ]; then
    compose_args+=("-f" "docker/docker-compose.dev.override.yml")
  fi
  compose_args+=("-p" "$project_name" "up" "-d")

  docker compose "${compose_args[@]}"

  echo -e "\n${GREEN}✅ $profile 환경이 시작되었습니다!${NC}"
  echo -e "${GREEN}   프로젝트: $project_name${NC}"
  echo -e "${GREEN}   웹 포트: $WEB_PORT${NC}"
  echo ""
}

agent_login() {
  local agent=$1

  if [ -z "$WORKSPACE" ]; then
    echo -e "${RED}--workspace 파라미터가 필요합니다.${NC}"
    echo -e "${YELLOW}예시: ./run.sh login $agent --workspace=/path/to/workspace${NC}"
    exit 1
  fi

  local agents_dir="$WORKSPACE/.agents"

  case "$agent" in
    claude)
      echo -e "\n${YELLOW}🔑 Claude 에이전트 로그인 중...${NC}"
      mkdir -p "$agents_dir/.claude"
      docker run --rm -it -v "$agents_dir/.claude:/root/.claude" soulflow-orchestrator claude login
      ;;
    codex)
      echo -e "\n${YELLOW}🔑 Codex 에이전트 로그인 중...${NC}"
      mkdir -p "$agents_dir/.codex"
      docker run --rm -it -p 1455:1456 -v "$agents_dir/.codex:/root/.codex" -v "$(pwd)/scripts/oauth-relay.mjs:/tmp/relay.mjs:ro" soulflow-orchestrator bash -c "node /tmp/relay.mjs 1456 1455 & codex auth login"
      ;;
    gemini)
      echo -e "\n${YELLOW}🔑 Gemini 에이전트 로그인 중...${NC}"
      mkdir -p "$agents_dir/.gemini"
      docker run --rm -it -v "$agents_dir/.gemini:/root/.gemini" soulflow-orchestrator gemini auth login
      ;;
    *)
      echo -e "${RED}알 수 없는 에이전트: $agent${NC}"
      echo "사용법: ./run.sh login [claude|codex|gemini]"
      exit 1
      ;;
  esac
}

case "$COMMAND" in
  dev|test|staging|prod)
    run_env "$COMMAND"
    ;;
  down)
    echo -e "\n${YELLOW}모든 환경 중지 중...${NC}"
    docker compose -f docker/docker-compose.yml down -v 2>/dev/null || true
    echo -e "${GREEN}✅ 모든 환경이 중지되었습니다${NC}\n"
    ;;
  status)
    echo -e "\n${BLUE}환경 상태:${NC}"
    docker compose ps 2>/dev/null || echo "실행 중인 환경 없음"
    ;;
  logs)
    echo -e "\n${BLUE}로그 확인 중... (Ctrl+C로 종료)${NC}"
    docker compose logs -f
    ;;
  login)
    AGENT=${2:-}
    if [ -z "$AGENT" ]; then
      echo -e "${RED}에이전트를 지정하세요${NC}"
      echo "사용법: ./run.sh login [claude|codex|gemini]"
      exit 1
    fi
    agent_login "$AGENT"
    ;;
  help)
    show_help
    ;;
  *)
    echo -e "${RED}알 수 없는 명령: $COMMAND${NC}"
    show_help
    exit 1
    ;;
esac
