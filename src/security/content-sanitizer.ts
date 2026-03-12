/**
 * 외부 콘텐츠(웹/LLM 출력) 프롬프트 인젝션 탐지 + 새니타이징.
 * web.ts, memory.service.ts 등에서 공유.
 */

/** NFKC 정규화 + 불가시 문자 제거 — Unicode confusable/zero-width 우회 차단 */
export function normalize_for_detection(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u034F/g, "")
    .replace(/[\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, "");
}

export const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /* ── English ── */
  /\bignore\s+(all\s+)?previous\s+instructions\b/i,
  /\bdisregard\s+(the\s+)?(system|developer)\s+prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(system|developer)\s+message\b/i,
  /\breveal\s+(your\s+)?(prompt|instructions|system\s*message)\b/i,
  /\bcall\s+the\s+tool\b/i,
  /\bexecute\s+(this|the)\s+command\b/i,
  /\brun\s+this\s+(shell|bash|powershell)\b/i,
  /\bcopy\s+and\s+paste\b/i,
  /\bdo\s+not\s+summari[sz]e\b/i,
  /\bact\s+as\s+(a\s+|an\s+)?/i,
  /\bnew\s+(role|persona|identity)\b/i,
  /\boverride\s+(all\s+)?(safety|security|restrictions|rules)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\s+mode\b/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  /\b(forget|reset)\s+(all\s+)?(previous|prior|earlier)\b/i,
  /\bsystem\s*:\s*you\s/i,
  /* ── 한국어 ── */
  /이전\s*(지시|명령|인스트럭션).*무시/,
  /시스템\s*프롬프트.*(공개|알려|보여)/,
  /너는?\s*이제\s/,
  /(명령|커맨드|코드).*실행\s*(해|하)/,
  /프롬프트.*(알려|공개|출력)/,
  /* ── 日本語 ── */
  /前の?(指示|命令).*無視/,
  /システムプロンプト.*(公開|教えて|見せて)/,
  /* ── 中文 ── */
  /忽略.*之前的?(指令|指示|命令)/,
  /(公开|显示).*系统提示/,
];

export interface SanitizeResult {
  text: string;
  suspicious_lines: number;
  removed_lines: string[];
}

/** 라인 단위 인젝션 패턴 탐지 + 제거 */
export function sanitize_untrusted_text(input: string): SanitizeResult {
  const raw = String(input || "");
  // ReDoS 방지: 패턴 적용 전 입력 길이 제한
  const lines = (raw.length > 512_000 ? raw.slice(0, 512_000) : raw).split(/\r?\n/);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    const normalized = normalize_for_detection(trimmed);
    const suspicious = PROMPT_INJECTION_PATTERNS.some((p) => p.test(normalized));
    if (suspicious) {
      removed.push(trimmed.slice(0, 200));
      continue;
    }
    kept.push(line);
  }
  return {
    text: kept.join("\n").trim(),
    suspicious_lines: removed.length,
    removed_lines: removed.slice(0, 20),
  };
}
