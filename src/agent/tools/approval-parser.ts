export type ApprovalDecision = "approve" | "deny" | "defer" | "cancel" | "clarify" | "unknown";

export type ApprovalParseResult = {
  decision: ApprovalDecision;
  confidence: number;
  normalized: string;
};

const APPROVE_PATTERNS: RegExp[] = [
  /\b(y|yes|ok|okay|approve|approved|allow|allowed|go|proceed)\b/i,
  /\b(승인|허용|진행|좋아|오케이|가능)\b/i,
  /✅|👍|🟢|🙆|👌/,
];

const DENY_PATTERNS: RegExp[] = [
  /\b(n|no|deny|denied|reject|rejected|stop|block|forbid)\b/i,
  /\b(거절|불가|금지|중단|안돼|안됨|취소해)\b/i,
  /❌|👎|🔴|🙅|⛔/,
];

const DEFER_PATTERNS: RegExp[] = [
  /\b(later|hold|wait|defer|postpone|pending)\b/i,
  /\b(보류|대기|나중에|잠시)\b/i,
  /⏸️|⏳|🤔/,
];

const CANCEL_PATTERNS: RegExp[] = [
  /\b(cancel|abort|drop)\b/i,
  /\b(취소|중단)\b/i,
];

const CLARIFY_PATTERNS: RegExp[] = [
  /\b(why|reason|explain|detail|what)\b/i,
  /\b(왜|이유|설명|근거|상세)\b/i,
];

function normalize(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function score(patterns: RegExp[], text: string): number {
  let s = 0;
  for (const p of patterns) {
    if (p.test(text)) s += 1;
  }
  return s;
}

export function parse_approval_response(input: string): ApprovalParseResult {
  const text = normalize(input);
  if (!text) return { decision: "unknown", confidence: 0, normalized: "" };

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
