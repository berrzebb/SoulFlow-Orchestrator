#!/usr/bin/env node

/**
 * 플랫폼 독립적인 컨테이너 관리 헬퍼
 * Docker/Podman을 자동으로 감지하여 사용
 *
 * 사용법:
 *   node scripts/container.js build
 *   node scripts/container.js bash
 *   node scripts/container.js test
 *   node scripts/container.js test:pty
 */

const { execSync } = require('child_process');
const { getContainerRuntime, getImageName } = require('./detect-container');

const command = process.argv[2];
const args = process.argv.slice(3);

try {
  const runtime = getContainerRuntime();
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

    default:
      console.error(`❌ 알 수 없는 명령어: ${command}`);
      console.error('사용 가능한 명령어: build, bash, test, test:pty');
      process.exit(1);
  }

  console.log(`📦 런타임: ${runtime}`);
  console.log(`🔧 명령어: ${cmd}\n`);

  execSync(cmd, {
    stdio: 'inherit'
  });
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
