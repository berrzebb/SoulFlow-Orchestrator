/** 시스템 프롬프트 버전 해시 — 동일 입력 → 동일 해시, 변경 감지용. */

import { createHash } from "node:crypto";

/** SHA-256 해시의 첫 12자를 반환. */
export function compute_prompt_version(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/** 프롬프트에 버전 해시를 주석으로 첨부. */
export function stamp_prompt_version(prompt: string): { prompt: string; version: string } {
  const version = compute_prompt_version(prompt);
  const stamped = `${prompt}\n\n<!-- prompt_version: ${version} -->`;
  return { prompt: stamped, version };
}
