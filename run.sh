#!/bin/bash

# SoulFlow Orchestrator 환경 관리 스크립트 (Linux/macOS)
# 사용법: ./run.sh dev|test|staging|prod|down|status|logs|help

set -e

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 환경변수 설정
WORKSPACE=${WORKSPACE:-/data}
WEB_PORT=${WEB_PORT:-}
REDIS_PORT=${REDIS_PORT:-}

show_help() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}  SoulFlow Orchestrator 환경 관리${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}환경 시작:${NC}"
  echo "  ./run.sh dev       - 개발 환경 시작"
  echo "  ./run.sh test      - 테스트 환경 시작"
  echo "  ./run.sh staging   - 스테이징 환경 시작"
  echo "  ./run.sh prod      - 프로덕션 환경 시작"
  echo ""
  echo -e "${YELLOW}관리:${NC}"
  echo "  ./run.sh status    - 환경 상태 확인"
  echo "  ./run.sh logs      - 로그 확인"
  echo "  ./run.sh down      - 모든 환경 중지"
  echo ""
  echo -e "${YELLOW}옵션:${NC}"
  echo "  WORKSPACE=/path ./run.sh dev            - 커스텀 워크스페이스"
  echo "  WEB_PORT=8080 ./run.sh dev              - 웹 포트"
  echo "  REDIS_PORT=6380 ./run.sh dev            - Redis 포트"
  echo ""
  echo -e "${BLUE}현재 설정:${NC}"
  echo "  워크스페이스: ${WORKSPACE}"
  if [ -n "$WEB_PORT" ]; then echo "  웹 포트: ${WEB_PORT}"; fi
  if [ -n "$REDIS_PORT" ]; then echo "  Redis 포트: ${REDIS_PORT}"; fi
  echo ""
}

run_env() {
  local profile=$1
  echo -e "\n${YELLOW}🚀 $profile 환경 시작 중...${NC}"
  echo "   워크스페이스: $WORKSPACE"

  export WORKSPACE="$WORKSPACE"
  [ -n "$WEB_PORT" ] && export WEB_PORT="$WEB_PORT"
  [ -n "$REDIS_PORT" ] && export REDIS_PORT="$REDIS_PORT"

  node setup-environment.js "$profile"
  docker compose -f "docker-compose.${profile}.yml" up -d

  echo -e "\n${GREEN}✅ $profile 환경이 시작되었습니다!${NC}"
}

case "${1:-help}" in
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
    for profile in dev test staging; do
      docker compose -f "docker-compose.${profile}.yml" down -v 2>/dev/null || true
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
  help|"")
    show_help
    ;;
  *)
    echo "알 수 없는 명령: $1"
    show_help
    exit 1
    ;;
esac
