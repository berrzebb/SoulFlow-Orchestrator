import { createHash } from "node:crypto";

/** SHA-256 앞 N자 hex. content hash / chunk_id 생성에 사용. length 기본값 16. */
export function sha256_short(input: string, length = 16): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}
