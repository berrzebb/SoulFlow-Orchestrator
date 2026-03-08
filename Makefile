.PHONY: help dev test staging prod down status logs clean

# 색상 정의
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

# 워크스페이스 설정
WORKSPACE ?= $(shell grep '^WORKSPACE=' .env 2>/dev/null | cut -d'=' -f2)
WORKSPACE ?= /data

help:
	@echo "$(BLUE)════════════════════════════════════════$(NC)"
	@echo "$(BLUE)  SoulFlow Orchestrator 환경 관리$(NC)"
	@echo "$(BLUE)════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)환경 시작:$(NC)"
	@echo "  make dev       - 개발 환경 시작 (포트 4200, 자동 리로드)"
	@echo "  make test      - 테스트 환경 시작 (포트 4201)"
	@echo "  make staging   - 스테이징 환경 시작 (포트 4202)"
	@echo "  make prod      - 프로덕션 환경 시작 (포트 4200)"
	@echo ""
	@echo "$(YELLOW)워크스페이스 옵션:$(NC)"
	@echo "  make dev WORKSPACE=/custom/path     - 커스텀 워크스페이스로 시작"
	@echo "  make dev WORKSPACE=./local-workspace"
	@echo ""
	@echo "$(YELLOW)관리:$(NC)"
	@echo "  make down      - 모든 환경 중지 및 정리"
	@echo "  make status    - 환경 상태 확인"
	@echo "  make logs      - 로그 확인"
	@echo "  make clean     - 완전 정리 (이미지, 볼륨 포함)"
	@echo ""
	@echo "$(YELLOW)개발:$(NC)"
	@echo "  make build     - 타입스크립트 빌드"
	@echo "  make test-unit - 유닛 테스트 실행"
	@echo "  make lint      - 코드 린트 검사"
	@echo "  make quality   - 전체 품질 검사 (build+lint+test)"
	@echo ""
	@echo "$(BLUE)현재 워크스페이스: $(WORKSPACE)$(NC)"
	@echo ""

# ─ 환경 시작 ─
dev:
	@echo "$(YELLOW)🚀 개발 환경 시작 중...$(NC)"
	@echo "   워크스페이스: $(WORKSPACE)"
	@WORKSPACE=$(WORKSPACE) node setup-environment.js dev
	@docker compose -f docker-compose.dev.yml up -d
	@echo "$(GREEN)✅ 개발 환경이 시작되었습니다!$(NC)"
	@echo "   웹: http://localhost:4200"
	@echo "   Redis: redis://localhost:6379"
	@echo "   워크스페이스: $(WORKSPACE)"

test:
	@echo "$(YELLOW)🧪 테스트 환경 시작 중...$(NC)"
	@echo "   워크스페이스: $(WORKSPACE)"
	@WORKSPACE=$(WORKSPACE) node setup-environment.js test
	@docker compose -f docker-compose.test.yml up -d
	@echo "$(GREEN)✅ 테스트 환경이 시작되었습니다!$(NC)"
	@echo "   웹: http://localhost:4201"
	@echo "   Redis: redis://localhost:6380"
	@echo "   워크스페이스: $(WORKSPACE)"

staging:
	@echo "$(YELLOW)📦 스테이징 환경 시작 중...$(NC)"
	@echo "   워크스페이스: $(WORKSPACE)"
	@WORKSPACE=$(WORKSPACE) node setup-environment.js staging
	@docker compose -f docker-compose.staging.yml up -d
	@echo "$(GREEN)✅ 스테이징 환경이 시작되었습니다!$(NC)"
	@echo "   웹: http://localhost:4202"
	@echo "   Redis: redis://localhost:6381"
	@echo "   워크스페이스: $(WORKSPACE)"

prod:
	@echo "$(YELLOW)🏢 프로덕션 환경 시작 중...$(NC)"
	@echo "   워크스페이스: $(WORKSPACE)"
	@WORKSPACE=$(WORKSPACE) node setup-environment.js prod
	@docker compose -f docker-compose.yml up -d
	@echo "$(GREEN)✅ 프로덕션 환경이 시작되었습니다!$(NC)"
	@echo "   웹: http://localhost:4200"
	@echo "   Redis: redis://localhost:6379"
	@echo "   워크스페이스: $(WORKSPACE)"

# ─ 관리 ─
down:
	@echo "$(YELLOW)⛔ 모든 환경 중지 중...$(NC)"
	@docker compose down -v 2>/dev/null || true
	@for profile in dev test staging; do \
		docker compose -f docker-compose.$$profile.yml down -v 2>/dev/null || true; \
	done
	@echo "$(GREEN)✅ 모든 환경이 중지되었습니다$(NC)"

status:
	@echo "$(BLUE)📊 환경 상태:$(NC)"
	@docker compose ps 2>/dev/null || echo "실행 중인 환경 없음"

logs:
	@echo "$(BLUE)📋 로그 확인 중... (Ctrl+C로 종료)$(NC)"
	@docker compose logs -f

clean:
	@echo "$(YELLOW)🧹 완전 정리 중...$(NC)"
	@docker compose down -v 2>/dev/null || true
	@for profile in dev test staging; do \
		docker compose -f docker-compose.$$profile.yml down -v 2>/dev/null || true; \
	done
	@docker image prune -a -f 2>/dev/null || true
	@docker volume prune -f 2>/dev/null || true
	@docker network prune -f 2>/dev/null || true
	@echo "$(GREEN)✅ 완전 정리 완료$(NC)"

# ─ 개발 ─
build:
	@echo "$(YELLOW)🔨 타입스크립트 빌드 중...$(NC)"
	@npm run build

test-unit:
	@echo "$(YELLOW)🧪 유닛 테스트 실행 중...$(NC)"
	@npm test

test-coverage:
	@echo "$(YELLOW)🧪 테스트 커버리지 확인 중...$(NC)"
	@npm run test:coverage

lint:
	@echo "$(YELLOW)🔍 코드 린트 검사 중...$(NC)"
	@npm run lint

lint-fix:
	@echo "$(YELLOW)🔧 코드 린트 자동 수정 중...$(NC)"
	@npm run lint:fix

quality: build lint test-unit
	@echo "$(GREEN)✅ 모든 품질 검사 통과!$(NC)"

# ─ 컨테이너 접속 ─
shell-dev:
	@docker exec -it soulflow-dev-orchestrator bash

shell-test:
	@docker exec -it soulflow-test-orchestrator bash

redis-dev:
	@docker exec -it soulflow-dev-redis redis-cli

redis-test:
	@docker exec -it soulflow-test-redis redis-cli

# ─ 빌드 ─
docker-build:
	@echo "$(YELLOW)🐳 Docker 이미지 빌드 중...$(NC)"
	@docker build -t soulflow-orchestrator:latest .
	@echo "$(GREEN)✅ Docker 이미지 빌드 완료$(NC)"

docker-build-nocache:
	@echo "$(YELLOW)🐳 Docker 이미지 빌드 중 (캐시 무효화)...$(NC)"
	@docker build --no-cache -t soulflow-orchestrator:latest .
	@echo "$(GREEN)✅ Docker 이미지 빌드 완료$(NC)"

.DEFAULT_GOAL := help
