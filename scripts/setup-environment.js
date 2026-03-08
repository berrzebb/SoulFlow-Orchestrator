#!/usr/bin/env node

/**
 * 환경 기반 Docker Compose 설정 생성 스크립트
 * 사용법: node setup-environment.js [profile]
 * 프로필: dev, test, staging (기본값: dev)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

function isRedisContainerRunning() {
  try {
    // Docker/Podman에서 redis 컨테이너 확인
    const cmd = 'docker ps --filter "ancestor=redis:*" --quiet 2>/dev/null || podman ps --filter "ancestor=redis:*" --quiet';
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return output.trim().length > 0; // 컨테이너가 실행 중이면 true
  } catch (e) {
    return false; // 컨테이너가 없으면 false
  }
}

const ENV_PROFILES = {
  dev: {
    name: 'Development',
    projectName: 'soulflow-dev',
    webPort: 4200,
    redisPort: 6379,
    workspace: '/data/workspace-dev',
    nodeEnv: 'development',
    debug: 'true',
    composeFile: 'docker/docker-compose.dev.yml',
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
    composeFile: 'docker/docker-compose.test.yml',
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
    composeFile: 'docker/docker-compose.staging.yml',
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
    composeFile: 'docker/docker-compose.prod.yml',
    buildTarget: 'full',
  },
};

function generateDockerCompose(profile, config, skipRedis = false) {
  // 환경별 볼륨 설정 (src, web은 프로젝트 루트 상대경로)
  const devVolumes = profile === 'dev'
    ? `      - ../src:/app/src  # 개발 모드 소스 마운트
      - ../web/src:/app/web/src  # 웹 개발 모드`
    : '';

  // CLI 에이전트 인증 정보 마운트 (workspace/.agents -> /root/.{claude,codex,gemini})
  const agentVolumes = `      - ${config.hostWorkspace}/.agents/.claude:/root/.claude
      - ${config.hostWorkspace}/.agents/.codex:/root/.codex
      - ${config.hostWorkspace}/.agents/.gemini:/root/.gemini`;

  // 환경별 커맨드
  const devCommand = profile === 'dev' ? '    command: npm run dev' : '';

  // 환경별 리소스 제한
  const memory = profile === 'prod' ? '2G' : '1G';
  const cpus = profile === 'prod' ? '4' : '2';

  // Redis 서비스 조건부 포함
  const dependsOnRedis = skipRedis ? '' : `    depends_on:
      redis:
        condition: service_healthy`;

  const redisService = skipRedis ? '' : `  redis:
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

`;

  const redisVolumes = skipRedis ? '' : `  ${config.projectName}-redis-data:
    driver: local
`;

  const volumesSection = redisVolumes ? `volumes:
${redisVolumes}` : '';

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
      context: ..
      dockerfile: docker/Dockerfile
      target: ${config.buildTarget}
    image: soulflow-orchestrator
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
      - ${config.hostWorkspace}:/data
${devVolumes}
${agentVolumes}
${dependsOnRedis}
${devCommand}
    deploy:
      resources:
        limits:
          memory: ${memory}
          cpus: "${cpus}"

${redisService}
${volumesSection}
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

  const config = { ...ENV_PROFILES[profile] };

  // 환경변수로 설정이 지정되면 사용 (파라미터 우선)
  const envWorkspace = process.env.WORKSPACE;
  const envWebPort = process.env.WEB_PORT;
  const envRedisPort = process.env.REDIS_PORT;
  const envInstance = process.env.INSTANCE;

  if (envWorkspace) {
    config.workspace = envWorkspace;
    config.projectName = `${config.projectName}-${process.env.USER || 'user'}`;
  }
  if (envInstance) {
    config.projectName = `${config.projectName}-${envInstance}`;
  }
  if (envWebPort) {
    config.webPort = parseInt(envWebPort, 10);
  }
  if (envRedisPort) {
    config.redisPort = parseInt(envRedisPort, 10);
  }

  // prod 환경에서는 컨테이너 내부 경로 /data 사용
  // 호스트 경로는 환경변수로 유지 (docker-compose volume mount용)
  config.hostWorkspace = envWorkspace || config.workspace;
  if (profile === 'prod') {
    config.workspace = '/data';
  }

  console.log(`\n🔧 ${config.name} 환경 설정 생성 중...\n`);

  // Redis 컨테이너 실행 여부 확인
  const skipRedis = process.env.SKIP_REDIS === 'true' || isRedisContainerRunning();
  if (skipRedis && process.env.SKIP_REDIS !== 'true') {
    console.log(`⚠️  Redis 컨테이너가 이미 실행 중입니다.`);
    console.log(`   기존 Redis 인스턴스에 연결합니다.\n`);
  } else if (process.env.SKIP_REDIS === 'true') {
    console.log(`⚠️  SKIP_REDIS=true로 설정되어 Redis 서비스를 생략합니다.\n`);
  }

  // docker-compose 파일 생성
  const composeContent = generateDockerCompose(profile, config, skipRedis);
  const composeFile = resolve(config.composeFile);
  mkdirSync(dirname(composeFile), { recursive: true });
  writeFileSync(composeFile, composeContent);
  console.log(`✅ ${config.composeFile} 생성됨`);

  // 워크스페이스의 agents 디렉토리 미리 생성 (docker volume mount 사전 요구)
  const agentsDir = resolve(config.hostWorkspace, '.agents');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(resolve(agentsDir, '.claude'), { recursive: true });
  mkdirSync(resolve(agentsDir, '.codex'), { recursive: true });
  mkdirSync(resolve(agentsDir, '.gemini'), { recursive: true });

  console.log(`\n📋 ${config.name} 환경 설정:`);
  console.log(`   프로젝트: ${config.projectName}`);
  console.log(`   웹 포트: ${config.webPort}`);
  console.log(`   Redis 포트: ${config.redisPort}`);
  console.log(`   워크스페이스: ${config.workspace}`);
  console.log(`   Node 환경: ${config.nodeEnv}`);

  // 스크립트에서 읽을 수 있는 형식으로 프로젝트명 출력
  console.log(`\n[PROJECT_NAME:${config.projectName}]`);

  console.log(`\n📌 환경변수 설정 (필요시):`);
  console.log(`   export WORKSPACE="${config.workspace}"`);
  console.log(`   export NODE_ENV="${config.nodeEnv}"`);
  console.log(`   export DEBUG="${config.debug}"\n`);
}

main();
