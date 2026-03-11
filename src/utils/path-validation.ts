/** 파일 경로 접근 검증 유틸리티 — 경로 순회(path traversal) 차단. */

import { resolve } from "node:path";

/**
 * 파일 경로가 허용 디렉토리 중 하나 이하인지 검증.
 * resolved 경로가 allowed_dirs 중 어느 것의 하위인지 확인한다.
 */
export function validate_file_path(file_path: string, allowed_dirs: string[]): boolean {
  if (!file_path) return false;
  const resolved = resolve(file_path);
  return allowed_dirs.some((dir) => {
    const norm = resolve(dir);
    return resolved === norm || resolved.startsWith(norm + "/") || resolved.startsWith(norm + "\\");
  });
}
