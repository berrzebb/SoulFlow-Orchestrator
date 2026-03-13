/**
 * Docker/Podman 자동 감지 모듈
 * 1. 명령 존재 여부 확인 (which/where)
 * 2. 버전 확인 (--version)
 * 3. 실제 작동 여부 확인 (ps)
 * 플랫폼별 우선순위:
 *   - Windows: Podman 우선 (Rancher Desktop)
 *   - Linux/macOS: Docker 우선
 * 둘 다 없거나 실행 불가면 에러 throw
 */

const { execSync } = require('child_process');

function isCommandAvailable(cmd) {
  try {
    const platform = process.platform;
    const checkCmd = platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function getContainerRuntime() {
  // 1단계: 명령 존재 여부 확인
  const hasDocker = isCommandAvailable('docker');
  const hasPodman = isCommandAvailable('podman');

  // 2단계: 버전 확인으로 실제 설치 여부 확인
  let canUseDocker = false;
  let canUsePodman = false;

  if (hasDocker) {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      canUseDocker = true;
    } catch (e) {
      // docker 명령은 있지만 버전 확인 실패
    }
  }

  if (hasPodman) {
    try {
      execSync('podman --version', { stdio: 'ignore' });
      canUsePodman = true;
    } catch (e) {
      // podman 명령은 있지만 버전 확인 실패
    }
  }

  // 3단계: 실제 작동 여부 확인 (플랫폼별 우선순위)
  const platform = process.platform;
  const isWindows = platform === 'win32';

  // Windows에서는 Podman 우선 (Rancher Desktop에서 더 안정적)
  // Linux/macOS에서는 Docker 우선
  if (isWindows && canUsePodman) {
    try {
      execSync('podman ps', { stdio: 'ignore' });
      return 'podman';
    } catch (e) {
      // podman이 설치되어 있지만 실행 불가
    }
  }

  if (canUseDocker) {
    try {
      execSync('docker ps', { stdio: 'ignore' });
      return 'docker';
    } catch (e) {
      // docker가 설치되어 있지만 실행 불가 (daemon 미실행 등)
    }
  }

  if (!isWindows && canUsePodman) {
    try {
      execSync('podman ps', { stdio: 'ignore' });
      return 'podman';
    } catch (e) {
      // podman이 설치되어 있지만 실행 불가
    }
  }

  // 설치는 되어 있으나 실행 불가인 경우 경고
  if (canUseDocker || canUsePodman) {
    const available = [];
    if (canUseDocker) available.push('Docker');
    if (canUsePodman) available.push('Podman');
    console.warn(`⚠️  ${available.join(' 또는 ')}이 설치되어 있지만 실행되지 않습니다.`);
    console.warn('   데몬이 실행 중인지 확인하세요.');
    // 플랫폼별 기본값
    if (isWindows) {
      return canUsePodman ? 'podman' : 'docker';
    } else {
      return canUseDocker ? 'docker' : 'podman';
    }
  }

  // 아무것도 없음
  throw new Error('❌ Docker 또는 Podman을 찾을 수 없습니다. 먼저 설치하고 실행하세요.');
}

function getImageName() {
  // package.json에서 빌드한 이미지명
  return 'soulflow-orchestrator';
}

function getComposeCommand() {
  const runtime = getContainerRuntime();
  return `${runtime} compose`;
}

module.exports = {
  getContainerRuntime,
  getImageName,
  getComposeCommand,
};
