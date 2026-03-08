#!/usr/bin/env node

/**
 * 플랫폼 독립적인 에이전트 로그인 헬퍼
 * 사용법: node scripts/login.js [claude|codex|gemini]
 */

const { execSync } = require('child_process');
const path = require('path');

const agent = process.argv[2];
const platform = process.platform;

if (!agent || !['claude', 'codex', 'gemini'].includes(agent)) {
  console.error('❌ 에이전트를 지정하세요: claude, codex, gemini');
  process.exit(1);
}

try {
  let command;
  if (platform === 'win32') {
    // Windows: run.cmd 사용
    command = `run.cmd login ${agent}`;
  } else {
    // Linux/macOS: run.sh 사용
    command = `./run.sh login ${agent}`;
  }

  execSync(command, {
    stdio: 'inherit',
    cwd: path.dirname(path.dirname(__filename)) // 프로젝트 루트
  });
} catch (error) {
  process.exit(1);
}
