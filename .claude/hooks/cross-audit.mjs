#!/usr/bin/env node
/**
 * PostToolUse hook: 양방향 감사 자동화.
 *
 * (A) Claude가 docs/feedback/claude.md 편집 + [GPT미검증] 존재 →
 *     feedback-audit.mjs 동기 실행 → GPT 응답 대기 → gpt.md 내용 stdout 출력
 *
 * (B) 모든 Edit/Write 시 gpt.md가 claude.md보다 최신이면 →
 *     미확인 GPT 응답 알림 stdout 출력 (1회)
 */
import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const debugLog = resolve(__dirname, "hook-debug.log");
const ackFile = resolve(__dirname, "gpt-ack.timestamp");

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

function find_feedback_file(name) {
  for (const variant of [name, name.toUpperCase(), name.toLowerCase()]) {
    const p = resolve(repoRoot, "docs", "feedback", variant);
    if (existsSync(p)) return p;
  }
  return null;
}

function get_mtime(filepath) {
  try { return statSync(filepath).mtimeMs; } catch { return 0; }
}

function read_ack_time() {
  try { return Number(readFileSync(ackFile, "utf8").trim()) || 0; } catch { return 0; }
}

function write_ack_time(ms) {
  writeFileSync(ackFile, String(ms), "utf8");
}

/** (B) gpt.md가 claude.md보다 최신이고 아직 확인하지 않았으면 알림. */
function check_pending_gpt_response() {
  const gptPath = find_feedback_file("gpt.md");
  const claudePath = find_feedback_file("claude.md") || find_feedback_file("CLAUDE.md");
  if (!gptPath || !claudePath) return;

  const gptMtime = get_mtime(gptPath);
  const claudeMtime = get_mtime(claudePath);
  const lastAck = read_ack_time();

  if (gptMtime > claudeMtime && gptMtime > lastAck) {
    write_ack_time(gptMtime);
    const content = readFileSync(gptPath, "utf8");
    log("NOTIFY: pending GPT response detected");
    process.stdout.write(
      `\n[cross-audit] GPT 감사 응답이 도착했습니다.\n` +
      `--- docs/feedback/gpt.md ---\n${content}\n---\n` +
      `위 피드백을 검토하고 docs/feedback/claude.md 를 업데이트하세요.\n`,
    );
  }
}

/** 저장된 감사 세션 ID 확인. */
function read_session_id() {
  const p = resolve(repoRoot, ".claude", "feedback-audit.session");
  try { return readFileSync(p, "utf8").trim() || null; } catch { return null; }
}

/** (A) claude.md 편집 시 GPT 감사 트리거 + 대기 + 결과 출력. */
function run_audit_and_wait() {
  log("MATCH: running feedback-audit.mjs (sync)");

  if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
    process.stdout.write("would-run: node scripts/feedback-audit.mjs\n");
    return;
  }

  const sessionId = read_session_id();
  const mode = sessionId ? `세션 재개 (${sessionId.slice(0, 8)}…)` : "새 세션";
  process.stdout.write(`[cross-audit] GPT 감사 요청: ${mode}. 응답 대기...\n`);

  const gptPathBefore = find_feedback_file("gpt.md");
  const mtimeBefore = gptPathBefore ? get_mtime(gptPathBefore) : 0;

  const result = spawnSync(
    process.execPath,
    [resolve(repoRoot, "scripts", "feedback-audit.mjs")],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    },
  );

  if (result.error) {
    log(`AUDIT ERROR: ${result.error.message}`);
    process.stdout.write(`[cross-audit] 감사 실행 실패: ${result.error.message}\n`);
    return;
  }

  if (result.status !== 0) {
    log(`AUDIT EXIT: code ${result.status}`);
    const stderr = (result.stderr || "").trim();
    process.stdout.write(`[cross-audit] 감사 비정상 종료 (code ${result.status})${stderr ? `: ${stderr}` : ""}\n`);
    return;
  }

  log("AUDIT COMPLETE");

  const gptPath = find_feedback_file("gpt.md");
  if (gptPath && existsSync(gptPath)) {
    const mtimeAfter = get_mtime(gptPath);
    const updated = mtimeAfter > mtimeBefore;
    const content = readFileSync(gptPath, "utf8");
    write_ack_time(Date.now());
    process.stdout.write(
      `\n[cross-audit] GPT 감사 완료${updated ? " (gpt.md 갱신됨)" : ""}.\n` +
      `--- docs/feedback/gpt.md ---\n${content}\n---\n` +
      `위 피드백을 검토하고 docs/feedback/claude.md 를 업데이트하세요.\n`,
    );
  } else {
    process.stdout.write("[cross-audit] 감사 완료. gpt.md 파일을 찾을 수 없습니다.\n");
  }
}

async function main() {
  log("Hook triggered (node)");

  if (process.env.FEEDBACK_LOOP_ACTIVE === "1") {
    log("EXIT: FEEDBACK_LOOP_ACTIVE=1");
    return;
  }

  // stdin 읽기
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw.trim()) {
    log("EXIT: empty stdin");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    log(`EXIT: JSON parse error: ${err.message}`);
    // JSON 파싱 실패해도 (B) 체크는 수행
    check_pending_gpt_response();
    return;
  }

  const filePath = String(payload?.tool_input?.file_path ?? "");
  log(`file_path=${filePath}`);

  // (A) claude.md 편집 감지
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("docs/feedback/claude.md")) {
    const claudePath = find_feedback_file("claude.md") || find_feedback_file("CLAUDE.md");
    if (claudePath) {
      const content = readFileSync(claudePath, "utf8");
      if (content.includes("[GPT미검증]")) {
        run_audit_and_wait();
        return;
      }
      log("EXIT: no [GPT미검증] tag");
    }
    return;
  }

  // (B) 다른 파일 편집 시 — 미확인 GPT 응답 체크
  check_pending_gpt_response();
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
});
