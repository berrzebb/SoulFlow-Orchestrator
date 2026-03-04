/** Secret Reader — Docker Secrets 파일에서 환경변수 값을 읽는 동기 헬퍼. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SecretMapping = {
  /** 환경변수 키. 예: "ANTHROPIC_API_KEY" */
  env_key: string;
  /** Docker secret 이름 (= 파일명). 예: "anthropic_api_key" */
  secret_name: string;
};

/**
 * Docker secrets 마운트 경로에서 값을 읽어 env 객체로 반환.
 * 파일 미존재 시 해당 매핑을 건너뜀 (에러 아님).
 */
export function resolve_secrets(
  mappings: SecretMapping[],
  secrets_path = "/run/secrets",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of mappings) {
    const value = read_secret_file(join(secrets_path, m.secret_name));
    if (value !== null) result[m.env_key] = value;
  }
  return result;
}

function read_secret_file(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}
