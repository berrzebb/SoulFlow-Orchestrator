/**
 * F5: Memory Quality Rules — memory 저장 항목의 품질 판정.
 *
 * precision > quantity 원칙:
 * - 짧고 밀도 있는 항목을 선호
 * - noisy tool output(shell/stack trace/test 결과)이 그대로 저장되지 않도록 검사
 * - 빈 항목과 과도하게 긴 항목 차단
 */

export type MemoryViolationCode =
  | "too_long"        // max_chars 초과
  | "noisy_content"   // shell 출력·stack trace·test 결과 패턴 감지
  | "empty_content";  // 공백 또는 빈 문자열

export interface MemoryViolation {
  code: MemoryViolationCode;
  severity: "major" | "minor";
  detail?: string;
}

export interface MemoryAuditResult {
  passed: boolean;
  violations: MemoryViolation[];
}

export interface MemoryEntry {
  content: string;
  /** ToolOutputReducer의 tool_name 힌트 (선택). */
  hint?: string;
}

export interface MemoryQualityRule {
  /** 항목 최대 길이. 초과 시 too_long. 기본 2_000자. */
  max_chars: number;
  /** noisy 패턴 검사 여부. 기본 true. */
  noisy_pattern_check: boolean;
}

/** 기본 규칙: 2,000자 이하, noisy 검사 활성. */
export const DEFAULT_MEMORY_QUALITY_RULE: MemoryQualityRule = {
  max_chars: 2_000,
  noisy_pattern_check: true,
};

/**
 * noisy tool output 감지 패턴.
 * ToolOutputKind(shell/test/diff) 결과가 그대로 저장되는 상황을 탐지.
 */
const NOISY_PATTERNS = [
  /^\s*\$\s+\S/m,                          // shell 프롬프트: $ command
  /^\s*(Error|Exception|Traceback)[\s:]/m, // stack trace 시작
  /^\s*at\s+\S+\s+\(.*:\d+:\d+\)/m,       // JS stack frame
  /^\s*PASS|FAIL|✓|✗|●\s+\S/m,           // 테스트 러너 출력
  /^---\s+\S.*\n\+\+\+\s+\S/m,            // diff 헤더
  /^\s*\[0m|\x1b\[/m,                     // ANSI escape code
];

/**
 * memory 항목 하나를 규칙에 따라 감사.
 */
export function audit_memory_entry(
  entry: MemoryEntry,
  rule: MemoryQualityRule = DEFAULT_MEMORY_QUALITY_RULE,
): MemoryAuditResult {
  const violations: MemoryViolation[] = [];
  const content = entry.content;

  if (!content || content.trim().length === 0) {
    violations.push({ code: "empty_content", severity: "major" });
    return { passed: false, violations };
  }

  if (content.length > rule.max_chars) {
    violations.push({
      code: "too_long",
      severity: "major",
      detail: `${content.length}자 > ${rule.max_chars}자 한도`,
    });
  }

  if (rule.noisy_pattern_check) {
    for (const pattern of NOISY_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({
          code: "noisy_content",
          severity: "minor",
          detail: `패턴 감지: ${pattern.source.slice(0, 40)}`,
        });
        break; // 패턴 하나만 보고
      }
    }
  }

  const has_major = violations.some((v) => v.severity === "major");
  return { passed: !has_major, violations };
}

/**
 * 여러 memory 항목을 일괄 감사. 항목별 결과 배열 반환.
 */
export function audit_memory_entries(
  entries: MemoryEntry[],
  rule: MemoryQualityRule = DEFAULT_MEMORY_QUALITY_RULE,
): MemoryAuditResult[] {
  return entries.map((e) => audit_memory_entry(e, rule));
}
