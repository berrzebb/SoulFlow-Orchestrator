#!/usr/bin/env node

/**
 * 플랫폼 독립적인 환경 관리 헬퍼
 * 사용법: node scripts/env.js [dev|test|staging|prod|down|status|logs|up] [args...]
 *
 * 예:
 *   node scripts/env.js dev
 *   node scripts/env.js dev --workspace=/custom/path
 *   node scripts/env.js down
 *   node scripts/env.js logs
 */

const { execSync } = require('child_process');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);
const platform = process.platform;

// 명령어 매핑: npm 스크립트 이름 → run.sh/run.cmd 이름
const commandMap = {
  'up': 'prod',      // container:up는 prod 환경 시작
  'dev': 'dev',
  'test': 'test',
  'staging': 'staging',
  'prod': 'prod',
  'down': 'down',
  'status': 'status',
  'logs': 'logs'
};

const actualCommand = commandMap[command];

if (!actualCommand) {
  console.error(`❌ 알 수 없는 명령어: ${command}`);
  console.error('사용 가능한 명령어: dev, test, staging, prod, down, status, logs, up');
  process.exit(1);
}

try {
  let script;
  if (platform === 'win32') {
    // Windows: run.cmd 사용
    script = 'run.cmd';
  } else {
    // Linux/macOS: run.sh 사용
    script = './run.sh';
  }

  const cmdParts = [script, actualCommand];
  if (args.length > 0) {
    cmdParts.push(...args);
  }
  const cmd = cmdParts.join(' ');

  execSync(cmd, {
    stdio: 'inherit',
    cwd: path.dirname(path.dirname(__filename)) // 프로젝트 루트
  });
} catch (error) {
  process.exit(1);
}
