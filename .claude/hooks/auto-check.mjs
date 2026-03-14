#!/usr/bin/env node
/**
 * PostToolUse hook: 파일 편집 후 자동 품질 검사.
 *
 * - *.ts (src/ or tests/) 편집 → eslint 즉시 실행 → 오류 출력
 * - package.json / package-lock.json 편집 → npm audit (high+) 실행
 *
 * 출력은 Claude 컨텍스트에 포함되어 즉시 수정 가능.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

async function main() {
  // 피드백 루프 재진입 방지
  if (process.env.FEEDBACK_LOOP_ACTIVE === "1") return;

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return;

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const filePath = String(payload?.tool_input?.file_path ?? "");
  if (!filePath) return;

  const normalized = filePath.replace(/\\/g, "/");

  // ── TS 파일 → eslint ──────────────────────────────
  const is_ts = normalized.endsWith(".ts");
  const in_src_or_tests =
    normalized.includes("/src/") || normalized.includes("/tests/");
  const not_node_modules = !normalized.includes("/node_modules/");

  if (is_ts && in_src_or_tests && not_node_modules) {
    // shell string 형식 — DEP0190 회피 (args 분리 없이 단일 커맨드 문자열)
    const safeFile = filePath.replace(/"/g, '\\"');
    const result = spawnSync(
      `npx eslint --no-error-on-unmatched-pattern "${safeFile}"`,
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true },
    );

    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    if (result.status !== 0 && output) {
      const fileName = filePath.split(/[\\/]/).pop();
      process.stdout.write(
        `\n[auto-check] eslint 오류 — ${fileName}:\n${output}\n` +
        `[auto-check] 위 lint 오류를 즉시 수정하세요.\n`,
      );
    }
  }

  // ── package.json / package-lock.json → npm audit ──
  const is_pkg =
    normalized.endsWith("package.json") ||
    normalized.endsWith("package-lock.json");

  if (is_pkg) {
    const result = spawnSync(
      "npm audit --audit-level=high",
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true },
    );

    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    if (result.status !== 0 && output) {
      process.stdout.write(
        `\n[auto-check] npm audit 취약점 (high+):\n${output}\n`,
      );
    }
  }
}

main().catch(() => {});
