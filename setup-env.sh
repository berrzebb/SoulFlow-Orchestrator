#!/bin/bash

# SoulFlow 환경 관리 스크립트 (Linux/macOS)
# 사용법: bash setup-env.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_menu() {
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}  SoulFlow Orchestrator 환경 관리${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  echo "1) 개발 환경 (Development) - 포트 4200"
  echo "2) 테스트 환경 (Test) - 포트 4201"
  echo "3) 스테이징 환경 (Staging) - 포트 4202"
  echo "4) 프로덕션 환경 (Production) - 포트 4200"
  echo ""
  echo "5) 환경 상태 확인"
  echo "6) 로그 확인"
  echo "7) 모든 환경 중지"
  echo "8) 종료"
  echo -e "\n선택하세요 (1-8): "
}

setup_env() {
  local profile=$1
  echo -e "\n${YELLOW}⚙️  설정 생성 중...${NC}"
  node setup-environment.js "$profile"

  echo -e "\n${YELLOW}🚀 환경 시작 중...${NC}"
  docker compose -f "docker-compose.${profile}.yml" up -d

  sleep 3
  docker compose -f "docker-compose.${profile}.yml" ps
}

show_status() {
  echo -e "\n${BLUE}📊 환경 상태:${NC}\n"

  for profile in dev test staging; do
    file="docker-compose.${profile}.yml"
    if [ -f "$file" ]; then
      echo -e "${YELLOW}${profile^^}:${NC}"
      docker compose -f "$file" ps 2>/dev/null || echo "  (실행 중이 아님)"
      echo ""
    fi
  done
}

show_logs() {
  echo -e "\n${YELLOW}어떤 환경의 로그를 보시겠습니까?${NC}"
  echo "1) 개발 (dev)"
  echo "2) 테스트 (test)"
  echo "3) 스테이징 (staging)"
  echo "4) 뒤로 가기"
  echo -e "\n선택하세요 (1-4): "
  read -r choice

  case $choice in
    1) docker compose -f docker-compose.dev.yml logs -f ;;
    2) docker compose -f docker-compose.test.yml logs -f ;;
    3) docker compose -f docker-compose.staging.yml logs -f ;;
    4) return ;;
    *) echo -e "${RED}❌ 잘못된 선택${NC}"; show_logs ;;
  esac
}

stop_all() {
  echo -e "\n${YELLOW}모든 환경을 중지하시겠습니까? (y/n): ${NC}"
  read -r confirm

  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    for profile in dev test staging; do
      file="docker-compose.${profile}.yml"
      if [ -f "$file" ]; then
        echo -e "${YELLOW}$profile 환경 중지 중...${NC}"
        docker compose -f "$file" down || true
      fi
    done
    echo -e "${GREEN}✅ 모든 환경이 중지되었습니다${NC}"
  fi
}

# 메인 루프
while true; do
  show_menu
  read -r choice

  case $choice in
    1) setup_env "dev" ;;
    2) setup_env "test" ;;
    3) setup_env "staging" ;;
    4) setup_env "prod" ;;
    5) show_status ;;
    6) show_logs ;;
    7) stop_all ;;
    8) echo -e "\n${GREEN}👋 종료합니다${NC}\n"; exit 0 ;;
    *) echo -e "${RED}❌ 잘못된 선택. 다시 시도하세요${NC}" ;;
  esac

  echo -e "\n${YELLOW}[Enter를 눌러 계속]${NC}"
  read -r
  clear
done
