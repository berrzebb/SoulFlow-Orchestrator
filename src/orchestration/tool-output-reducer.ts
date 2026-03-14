/**
 * E1: Provider-Neutral ToolOutputReducer.
 *
 * raw tool 결과를 kind별로 감지하여 3개 projection으로 분리:
 *   - prompt_text  : LLM 다음 턴에 주입되는 압축 텍스트
 *   - display_text : 사용자에게 보이는 채널/대시보드용 텍스트
 *   - storage_text : 메모리/이벤트 로그에 저장되는 요약 텍스트
 *
 * 감지 실패 시 기존 truncate_tool_result 동작과 동일한 fallback 보장.
 */

// ── Types ────────────────────────────────────────────────────────

export type ToolOutputKind =
  | "plain"   // 기본 fallback
  | "shell"   // 명령어 실행 출력, 에러
  | "test"    // 테스트 러너 출력 (vitest/jest/pytest 등)
  | "json"    // 파싱 가능한 JSON 객체/배열
  | "diff"    // git diff / unified diff
  | "log"     // 타임스탬프/레벨 포함 로그
  | "table";  // pipe-delimited 테이블

export interface ReducedOutput {
  kind: ToolOutputKind;
  raw_text: string;
  prompt_text: string;
  display_text: string;
  storage_text: string;
  meta: {
    raw_chars: number;
    raw_lines: number;
    /** prompt_text가 raw_text보다 짧으면 true. */
    truncated: boolean;
    detector?: string;
  };
}

export interface ToolOutputReducer {
  reduce(args: {
    tool_name: string;
    params: Record<string, unknown>;
    result_text: string;
    is_error: boolean;
  }): ReducedOutput;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * ToolOutputReducer 생성.
 *
 * @param max_prompt_chars  prompt_text 최대 길이 (기본 5000).
 *                          display_text = 2×, storage_text = 1.5× 비율 적용.
 */
export function create_tool_output_reducer(max_prompt_chars = 5_000): ToolOutputReducer {
  return {
    reduce({ tool_name, result_text, is_error }): ReducedOutput {
      if (is_error) {
        // 에러는 압축하지 않음 — 전체 에러 메시지를 LLM에 전달해야 디버깅 가능
        return make_passthrough("plain", result_text, "is_error");
      }
      const kind = detect_output_kind(tool_name, result_text);
      return reduce_by_kind(kind, result_text, max_prompt_chars);
    },
  };
}

// ── Kind Detection ────────────────────────────────────────────────

export function detect_output_kind(tool_name: string, text: string): ToolOutputKind {
  const trimmed = text.trim();
  if (!trimmed) return "plain";

  // JSON: 파싱 가능한 객체/배열
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && is_valid_json(trimmed)) {
    return "json";
  }

  // Diff: unified diff 마커
  if (/^(diff |---\s|\+\+\+\s|@@\s)/m.test(trimmed)) return "diff";

  // Test: 테스트 러너 출력 패턴
  if (is_test_output(tool_name, trimmed)) return "test";

  // Log: 타임스탬프 또는 레벨 마커
  if (is_log_output(trimmed)) return "log";

  // Table: pipe-delimited 행이 2개 이상
  const pipe_rows = trimmed.split("\n").filter((l) => /^\|.+\|/.test(l));
  if (pipe_rows.length >= 2) return "table";

  // Shell: 명령어 실행 패턴 또는 도구명 힌트
  if (is_shell_output(tool_name, trimmed)) return "shell";

  return "plain";
}

// ── Reduction Dispatch ────────────────────────────────────────────

function reduce_by_kind(kind: ToolOutputKind, raw: string, max: number): ReducedOutput {
  switch (kind) {
    case "json":  return reduce_json(raw, max);
    case "diff":  return reduce_diff(raw, max);
    case "test":  return reduce_test(raw, max);
    case "log":   return reduce_log(raw, max);
    case "table": return reduce_table(raw, max);
    case "shell": return reduce_shell(raw, max);
    default:      return reduce_plain(raw, max);
  }
}

// ── Per-Kind Reducers ─────────────────────────────────────────────

function reduce_plain(raw: string, max: number): ReducedOutput {
  return make_reduced("plain", raw, {
    prompt:  truncate_half(raw, max),
    display: truncate_half(raw, max * 2),
    storage: truncate_half(raw, Math.floor(max * 1.5)),
  });
}

function reduce_json(raw: string, max: number): ReducedOutput {
  try {
    const parsed: unknown = JSON.parse(raw);
    const prompt  = json_summary(parsed, max);
    const display = json_summary(parsed, max * 2);
    const storage = json_summary(parsed, Math.floor(max * 1.5));
    return make_reduced("json", raw, { prompt, display, storage }, "json_parse");
  } catch {
    return reduce_plain(raw, max);
  }
}

function reduce_diff(raw: string, max: number): ReducedOutput {
  const lines = raw.split("\n");
  const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const file_lines = lines.filter((l) => /^(diff |--- |\+\+\+ )/.test(l));
  const header = `diff: +${additions} -${deletions} lines, ${file_lines.length} file(s)`;
  const key_lines = [header, ...file_lines.slice(0, 8)].join("\n");
  return make_reduced("diff", raw, {
    prompt:  key_lines.slice(0, max),
    display: [header, ...lines.slice(0, 40)].join("\n").slice(0, max * 2),
    storage: key_lines.slice(0, Math.floor(max * 1.5)),
  }, "diff_markers");
}

function reduce_test(raw: string, max: number): ReducedOutput {
  const lines = raw.split("\n");
  const summary = lines.find((l) => /\d+\s+(test|spec|passing|failing|passed|failed)/i.test(l)) ?? "";
  const failures = lines.filter((l) => /\b(FAIL|✗|×|Error:|AssertionError)/i.test(l)).slice(0, 5);
  const key = [summary, ...failures].filter(Boolean).join("\n");
  const prompt = (key || raw).slice(0, max);
  return make_reduced("test", raw, {
    prompt,
    display: [summary, ...lines.slice(0, 30)].join("\n").slice(0, max * 2),
    storage: (key || raw).slice(0, Math.floor(max * 1.5)),
  }, "test_runner");
}

function reduce_log(raw: string, max: number): ReducedOutput {
  const lines = raw.split("\n");
  const errors = lines.filter((l) => /\b(ERROR|FATAL|CRITICAL)\b/.test(l));
  const tail = lines.slice(-20).join("\n");
  const key = errors.length > 0
    ? `[${errors.length} ERROR(s)]\n${errors[0]}\n---\n${tail}`
    : tail;
  return make_reduced("log", raw, {
    prompt:  key.slice(0, max),
    display: raw.slice(0, max * 2),
    storage: key.slice(0, Math.floor(max * 1.5)),
  }, "log_markers");
}

function reduce_table(raw: string, max: number): ReducedOutput {
  const rows = raw.split("\n").filter((l) => l.includes("|"));
  const [header = "", sep = ""] = rows;
  const data = rows.slice(2);
  const preview = [header, sep, `[${data.length} rows]`, ...data.slice(0, 5)].join("\n");
  return make_reduced("table", raw, {
    prompt:  preview.slice(0, max),
    display: [header, sep, ...data.slice(0, 20)].join("\n").slice(0, max * 2),
    storage: preview.slice(0, Math.floor(max * 1.5)),
  }, "pipe_table");
}

function reduce_shell(raw: string, max: number): ReducedOutput {
  const lines = raw.split("\n");
  const error_lines = lines.filter((l) => /\b(error|failed|exception|cannot|permission denied)\b/i.test(l));
  const tail = lines.slice(-10).join("\n");
  const key = error_lines.length > 0
    ? `${error_lines[0]}\n---\n${tail}`
    : tail;
  return make_reduced("shell", raw, {
    prompt:  key.slice(0, max),
    display: raw.slice(0, max * 2),
    storage: key.slice(0, Math.floor(max * 1.5)),
  }, "shell_patterns");
}

// ── Helpers ───────────────────────────────────────────────────────

/** truncate_tool_result 동작과 동일한 앞뒤 절반 잘라내기. */
export function truncate_half(text: string, max: number): string {
  const limit = Math.max(100, max);
  if (text.length <= limit) return text;
  const half = Math.max(0, Math.floor((limit - 40) / 2));
  if (half === 0) return text.slice(0, limit);
  return `${text.slice(0, half)}\n...[truncated ${text.length - limit} chars]...\n${text.slice(-half)}`;
}

function is_valid_json(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

function is_test_output(tool_name: string, text: string): boolean {
  if (/vitest|jest|mocha|pytest|cargo\s*test|npm\s*test|npx\s*vitest/i.test(tool_name)) return true;
  return /\b(\d+\s+(tests?|specs?)\s+(pass|fail)|passing\b|failing\b|\bPASS\b|\bFAIL\b|✓|✗)\b/.test(text);
}

function is_log_output(text: string): boolean {
  return /(\[INFO\]|\[DEBUG\]|\[WARN\]|\[ERROR\]|INFO:|DEBUG:|WARN:|ERROR:|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/.test(text);
}

function is_shell_output(tool_name: string, text: string): boolean {
  if (/bash|shell|sh\b|cmd|powershell|exec|run_command|execute_command/i.test(tool_name)) return true;
  return /^(\$\s|#\s|Error:|FAILED|Command failed|exit code\s+\d)/m.test(text);
}

function json_summary(obj: unknown, max: number): string {
  if (obj === null || typeof obj !== "object") return String(obj).slice(0, max);

  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return "{}";

  const lines: string[] = [`{${entries.length} keys}`];
  let chars = lines[0].length;

  for (const [k, v] of entries) {
    const entry = `  "${k}": ${JSON.stringify(v)}`;
    if (chars + entry.length > max) {
      lines.push(`  ...[${entries.length - lines.length + 1} more key(s)]`);
      break;
    }
    lines.push(entry);
    chars += entry.length;
  }
  return lines.join("\n");
}

function make_reduced(
  kind: ToolOutputKind,
  raw: string,
  projections: { prompt: string; display: string; storage: string },
  detector?: string,
): ReducedOutput {
  return {
    kind,
    raw_text: raw,
    prompt_text:  projections.prompt,
    display_text: projections.display,
    storage_text: projections.storage,
    meta: {
      raw_chars:  raw.length,
      raw_lines:  raw.split("\n").length,
      truncated:  projections.prompt.length < raw.length,
      detector,
    },
  };
}

function make_passthrough(kind: ToolOutputKind, raw: string, detector: string): ReducedOutput {
  return make_reduced(kind, raw, { prompt: raw, display: raw, storage: raw }, detector);
}
