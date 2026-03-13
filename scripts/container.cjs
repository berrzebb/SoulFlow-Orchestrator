#!/usr/bin/env node

/**
 * 플랫폼 독립적인 컨테이너 관리 헬퍼
 * Docker/Podman을 자동으로 감지하여 사용
 *
 * 사용법:
 *   node scripts/container.cjs build           # 단일 이미지 빌드
 *   node scripts/container.cjs bash            # 컨테이너 셸 접속
 *   node scripts/container.cjs test            # 전체 테스트
 *   node scripts/container.cjs test:pty        # PTY 테스트
 *   node scripts/container.cjs compose:build   # compose 빌드
 *   node scripts/container.cjs compose:up      # compose 시작
 *   node scripts/container.cjs compose:down    # compose 종료 + 볼륨 제거
 *   node scripts/container.cjs compose:logs    # orchestrator 로그
 */

const { execSync } = require('child_process');
const { getContainerRuntime, getComposeCommand, getImageName } = require('./detect-container.cjs');

const command = process.argv[2];
const args = process.argv.slice(3);
const COMPOSE_FILE = 'docker/docker-compose.yml';

try {
  const runtime = getContainerRuntime();
  const compose = getComposeCommand();
  const imageName = getImageName();

  let cmd;

  switch (command) {
    case 'build':
      cmd = `${runtime} build -t ${imageName} .`;
      break;

    case 'bash':
      cmd = `${runtime} exec -it ${imageName} bash`;
      break;

    case 'test':
      cmd = `${runtime} exec -it ${imageName} npx vitest run`;
      break;

    case 'test:pty':
      cmd = `${runtime} exec -it ${imageName} npx vitest run tests/agent/pty/`;
      break;

    case 'compose:build':
      cmd = `${compose} -f ${COMPOSE_FILE} build ${args.join(' ')}`.trim();
      break;

    case 'compose:up':
      cmd = `${compose} -f ${COMPOSE_FILE} up -d ${args.join(' ')}`.trim();
      break;

    case 'compose:down':
      cmd = `${compose} -f ${COMPOSE_FILE} down -v`;
      break;

    case 'compose:logs':
      cmd = `${compose} -f ${COMPOSE_FILE} logs -f orchestrator`;
      break;

    case 'compose:restart':
      cmd = `${compose} -f ${COMPOSE_FILE} restart orchestrator`;
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: build, bash, test, test:pty, compose:build, compose:up, compose:down, compose:logs, compose:restart');
      process.exit(1);
  }

  console.log(`runtime: ${runtime}`);
  console.log(`exec: ${cmd}\n`);

  execSync(cmd, { stdio: 'inherit' });
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
