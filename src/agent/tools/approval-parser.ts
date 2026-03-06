import { normalize_text } from "../../utils/common.js";

export type ApprovalDecision = "approve" | "approve_all" | "deny" | "defer" | "cancel" | "clarify" | "unknown";

export type ApprovalParseResult = {
  decision: ApprovalDecision;
  confidence: number;
  normalized: string;
};

/** 한글은 \b word boundary가 작동하지 않으므로 단순 포함 매칭 사용. */
function ko(words: string): RegExp {
  return new RegExp(`(${words})`);
}

const APPROVE_PATTERNS: RegExp[] = [
  /\b(y|yes|ok|okay|approve|approved|allow|allowed|go|proceed)\b/i,
  ko("승인|허용|진행|좋아|오케이|가능"),
  /✅|👍|🟢|🙆|👌/,
];

const DENY_PATTERNS: RegExp[] = [
  /\b(n|no|deny|denied|reject|rejected|stop|block|forbid)\b/i,
  ko("거절|불가|금지|중단|안돼|안됨|취소해"),
  /❌|👎|🔴|🙅|⛔/,
];

const DEFER_PATTERNS: RegExp[] = [
  /\b(later|hold|wait|defer|postpone|pending)\b/i,
  ko("보류|대기|나중에|잠시"),
  /⏸️|⏳|🤔/,
];

const CANCEL_PATTERNS: RegExp[] = [
  /\b(cancel|abort|drop)\b/i,
  ko("취소|중단"),
];

const CLARIFY_PATTERNS: RegExp[] = [
  /\b(why|reason|explain|detail|what)\b/i,
  ko("왜|이유|설명|근거|상세"),
];

function score(patterns: RegExp[], text: string): number {
  let s = 0;
  for (const p of patterns) {
    if (p.test(text)) s += 1;
  }
  return s;
}

const APPROVE_ALL_PATTERNS: RegExp[] = [
  /\b(approve\s*all|allow\s*all|yes\s*all)\b/i,
  ko("모두 승인|전부 승인|일괄 승인|모두 허용|전부 허용"),
];

export function parse_approval_response(input: string): ApprovalParseResult {
  const text = normalize_text(input);
  if (!text) return { decision: "unknown", confidence: 0, normalized: "" };

  // "모두 승인"은 일반 승인보다 우선 감지 (approve_all 패턴이 approve 패턴의 상위 집합)
  if (score(APPROVE_ALL_PATTERNS, text) > 0) {
    return { decision: "approve_all", confidence: 0.9, normalized: text.toLowerCase() };
  }

  const scores: Array<{ decision: ApprovalDecision; score: number }> = [
    { decision: "approve", score: score(APPROVE_PATTERNS, text) },
    { decision: "deny", score: score(DENY_PATTERNS, text) },
    { decision: "defer", score: score(DEFER_PATTERNS, text) },
    { decision: "cancel", score: score(CANCEL_PATTERNS, text) },
    { decision: "clarify", score: score(CLARIFY_PATTERNS, text) },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  if (!top || top.score <= 0) return { decision: "unknown", confidence: 0.1, normalized: text.toLowerCase() };

  const second = scores[1];
  const margin = top.score - (second?.score || 0);
  const confidence = Math.min(1, 0.5 + (margin * 0.2));
  return {
    decision: top.decision,
    confidence,
    normalized: text.toLowerCase(),
  };
}
