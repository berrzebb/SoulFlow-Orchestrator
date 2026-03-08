#!/usr/bin/env node

/**
 * 환경 기반 Docker Compose 설정 생성 스크립트
 * 사용법: node setup-environment.js [profile]
 * 프로필: dev, test, staging (기본값: dev)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ENV_PROFILES = {
  dev: {
    name: 'Development',
    projectName: 'soulflow-dev',
    webPort: 4200,
    redisPort: 6379,
    workspace: '/data/workspace-dev',
    nodeEnv: 'development',
    debug: 'true',
    composeFile: 'docker-compose.dev.yml',
    buildTarget: 'dev',
  },
  test: {
    name: 'Test',
    projectName: 'soulflow-test',
    webPort: 4201,
    redisPort: 6380,
    workspace: '/data/workspace-test',
    nodeEnv: 'test',
    debug: 'true',
    composeFile: 'docker-compose.test.yml',
    buildTarget: 'production',
  },
  staging: {
    name: 'Staging',
    projectName: 'soulflow-staging',
    webPort: 4202,
    redisPort: 6381,
    workspace: '/data/workspace-staging',
    nodeEnv: 'production',
    debug: 'false',
    composeFile: 'docker-compose.staging.yml',
    buildTarget: 'production',
  },
  prod: {
    name: 'Production',
    projectName: 'soulflow-orchestrator',
    webPort: 4200,
    redisPort: 6379,
    workspace: '/data',
    nodeEnv: 'production',
    debug: 'false',
    composeFile: 'docker-compose.yml',
    buildTarget: 'full',
  },
};

function generateDockerCompose(profile, config) {
  return `version: "3.9"

services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTAINERS: 1
      IMAGES: 0
      NETWORKS: 0
      VOLUMES: 0
      POST: 1
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: "0.5"

  orchestrator:
    build:
      context: .
      dockerfile: Dockerfile
      target: ${config.buildTarget}
    container_name: ${config.projectName}-orchestrator
    restart: unless-stopped
    ports:
      - "${config.webPort}:4200"
    environment:
      NODE_ENV: ${config.nodeEnv}
      WORKSPACE: ${config.workspace}
      REDIS_URL: redis://redis:6379
      DEBUG: ${config.debug}
    volumes:
      - ${config.projectName}-workspace:/data
      ${profile === 'dev' ? '- ./src:/app/src  # 개발 모드 소스 마운트' : ''}
      ${profile === 'dev' ? '- ./web/src:/app/web/src  # 웹 개발 모드' : ''}
    depends_on:
      redis:
        condition: service_healthy
    ${profile === 'dev' ? 'command: npm run dev' : ''}
    deploy:
      resources:
        limits:
          memory: ${profile === 'prod' ? '2G' : '1G'}
          cpus: ${profile === 'prod' ? '"4"' : '"2"'}

  redis:
    image: redis:7-alpine
    container_name: ${config.projectName}-redis
    restart: unless-stopped
    ports:
      - "${config.redisPort}:6379"
    volumes:
      - ${config.projectName}-redis-data:/data
    command: >
      redis-server
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 384M
          cpus: "0.5"

volumes:
  ${config.projectName}-workspace:
    driver: local
  ${config.projectName}-redis-data:
    driver: local

networks:
  default:
    name: ${config.projectName}-network
`;
}

function generateEnvFile(profile, config) {
  return `# ${config.name} Environment
COMPOSE_PROJECT_NAME=${config.projectName}
NODE_ENV=${config.nodeEnv}
DEBUG=${config.debug}

# Ports
REDIS_PORT=${config.redisPort}
WEB_PORT=${config.webPort}

# Paths
WORKSPACE=${config.workspace}

# Database
REDIS_URL=redis://redis:6379

# Application
LOG_LEVEL=${profile === 'dev' ? 'debug' : 'info'}
`;
}

function main() {
  const profile = process.argv[2]?.toLowerCase() || 'dev';

  if (!ENV_PROFILES[profile]) {
    console.error(`❌ 알 수 없는 프로필: ${profile}`);
    console.error(`\n지원하는 프로필: ${Object.keys(ENV_PROFILES).join(', ')}`);
    process.exit(1);
  }

  // WORKSPACE 환경변수 또는 기본값 사용
  const envWorkspace = process.env.WORKSPACE;

  const config = { ...ENV_PROFILES[profile] };

  // 환경변수로 WORKSPACE가 지정되면 사용 (격리 목적)
  if (envWorkspace) {
    config.workspace = envWorkspace;
    config.projectName = `${config.projectName}-${process.env.USER || 'user'}`;
  }

  console.log(`\n🔧 ${config.name} 환경 설정 생성 중...\n`);

  // docker-compose 파일 생성
  const composeContent = generateDockerCompose(profile, config);
  const composeFile = resolve(config.composeFile);
  writeFileSync(composeFile, composeContent);
  console.log(`✅ ${config.composeFile} 생성됨`);

  // .env 파일 생성
  const envContent = generateEnvFile(profile, config);
  const envFile = resolve(`.env.${profile}`);
  writeFileSync(envFile, envContent);
  console.log(`✅ .env.${profile} 생성됨`);

  console.log(`\n📋 ${config.name} 환경 설정:`);
  console.log(`   프로젝트: ${config.projectName}`);
  console.log(`   웹 포트: ${config.webPort}`);
  console.log(`   Redis 포트: ${config.redisPort}`);
  console.log(`   워크스페이스: ${config.workspace}`);
  console.log(`   Node 환경: ${config.nodeEnv}`);

  console.log(`\n🚀 시작하려면:\n`);
  console.log(`   docker compose -f ${config.composeFile} up -d\n`);
  console.log(`또는 다음 명령어를 사용하세요:\n`);
  console.log(`   npm run env:${profile}\n`);
}

main();
