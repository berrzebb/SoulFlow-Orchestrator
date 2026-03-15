#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const promptTemplatePath = resolve(__dirname, "feedback-audit-prompt.md");
const claudePath = resolve(repoRoot, "docs", "feedback", "claude.md");
const gptPath = resolve(repoRoot, "docs", "feedback", "gpt.md");
const sessionPath = resolve(repoRoot, ".claude", "feedback-audit.session");
const promotionDocPaths = [
  resolve(repoRoot, "docs", "ko", "design", "improved", "feedback-promotion.md"),
  resolve(repoRoot, "docs", "en", "design", "improved", "feedback-promotion.md"),
];
const STATUS_TAG_RE = /\[(합의완료|계류|GPT미검증)(?:[^\]]*)\]/;

function usage() {
  console.log(`Usage: node scripts/feedback-audit.mjs [options]

Options:
  --scope <text>     Override audit scope shown to Codex
  --model <name>     Pass a model to codex exec (default: gpt-5.4)
  --sandbox <mode>   Pass a sandbox mode to codex exec (default: danger-full-access)
                     danger-full-access also enables no-approval execution on resume/new sessions
  --session-id <id>  Resume a specific Codex audit session id
  --resume-last      Resume the most recent Codex session in this repo
  --no-resume        Always start a new Codex session
  --reset-session    Delete the saved audit session id before running
  --debug-bin        Print the resolved Codex executable before running
  --auto-fix         Run feedback-respond with --auto-fix after audit
  --no-sync          Skip feedback-respond after audit
  --no-pick-next     Skip syncing the next-task section after audit
  --dry-run          Print the generated prompt and exit
  --json             Pass --json to codex exec
  -h, --help         Show this help

Environment:
  CODEX_BIN          Override the Codex executable path

Examples:
  node scripts/feedback-audit.mjs
  node scripts/feedback-audit.mjs --scope "Observability Layer / Bundle O3"
  node scripts/feedback-audit.mjs --model gpt-5.4
  node scripts/feedback-audit.mjs --resume-last
  node scripts/feedback-audit.mjs --reset-session
  node scripts/feedback-audit.mjs --auto-fix
`);
}

function parseArgs(argv) {
  const args = {
    scope: null,
    model: "gpt-5.4",
    sandbox: "danger-full-access",
    sessionId: null,
    resumeLast: false,
    resume: true,
    resetSession: false,
    debugBin: false,
    autoFix: false,
    dryRun: false,
    json: false,
    sync: true,
    pickNext: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[++i] ?? null;
      continue;
    }
    if (arg === "--model") {
      args.model = argv[++i] ?? null;
      continue;
    }
    if (arg === "--sandbox") {
      args.sandbox = argv[++i] ?? null;
      continue;
    }
    if (arg === "--session-id") {
      args.sessionId = argv[++i] ?? null;
      continue;
    }
    if (arg === "--resume-last") {
      args.resumeLast = true;
      continue;
    }
    if (arg === "--no-resume") {
      args.resume = false;
      continue;
    }
    if (arg === "--reset-session") {
      args.resetSession = true;
      continue;
    }
    if (arg === "--debug-bin") {
      args.debugBin = true;
      continue;
    }
    if (arg === "--auto-fix") {
      args.autoFix = true;
      continue;
    }
    if (arg === "--no-sync") {
      args.sync = false;
      continue;
    }
    if (arg === "--no-pick-next") {
      args.pickNext = false;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readSavedSession() {
  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const stored = JSON.parse(readFileSync(sessionPath, "utf8"));
    if (!stored.id) return null;
    // mtime 체크 제거: CLAUDE.md 변경(새 증거 제출)이 세션을 파괴해서는 안 됨.
    // 세션은 모든 항목이 [합의완료]가 될 때만 리셋 (deleteSavedSessionId 참조).
    return stored.id;
  } catch {
    // 파싱 실패 → 무효화
    return null;
  }
}

function writeSavedSession(sessionId) {
  mkdirSync(resolve(repoRoot, ".claude"), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify({ id: sessionId }) + "\n", "utf8");
}

function deleteSavedSessionId() {
  if (existsSync(sessionPath)) {
    rmSync(sessionPath, { force: true });
  }
}

function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) {
    return null;
  }

  const statuses = [...match[0].matchAll(/합의완료|계류|GPT미검증/g)].map((item) => item[0]);
  return statuses.at(-1) ?? null;
}

function hasPendingItems(markdown) {
  return /\[(GPT미검증|계류)\]/.test(markdown);
}

function detectScope(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+감사 범위\s*$/.test(line.trim()));
  const end = start >= 0
    ? lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()))
    : -1;
  const section = start >= 0
    ? lines.slice(start + 1, end >= 0 ? end : lines.length)
    : lines;

  const normalized = section
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const pending = normalized.filter((line) => extractStatusFromLine(line) === "GPT미검증");
  if (pending.length > 0) {
    return pending.map((line) => line.replace(/^- /, "")).join("\n");
  }

  const fallback = normalized.filter((line) => extractStatusFromLine(line) === "계류");
  if (fallback.length > 0) {
    return fallback.map((line) => line.replace(/^- /, "")).join("\n");
  }

  return "현재 docs/feedback/claude.md의 미합의 항목";
}

function readSectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end >= 0 ? end : lines.length);
}

function loadPromotionHint() {
  for (const docPath of promotionDocPaths) {
    if (!existsSync(docPath)) {
      continue;
    }

    const markdown = readFileSync(docPath, "utf8");
    const lines = readSectionLines(markdown, "현재 승격 대상").concat(readSectionLines(markdown, "Current Promotion Target"));
    const firstBullet = lines
      .map((line) => line.trim())
      .find((line) => line.startsWith("- "));

    if (firstBullet) {
      return {
        docPath,
        nextTask: firstBullet.replace(/^- /, "").trim(),
      };
    }
  }

  return null;
}

function buildPromotionSection(promotionHint) {
  if (!promotionHint) return "";
  return `
합의 승격 규칙:
- 현재 감사 범위가 검증 후 모두 \`[합의완료]\`이면 \`## 다음 작업\`은 임의 생성하지 말고 아래 승격 후보를 그대로 사용하세요.
- 승격 후보 출처: \`${promotionHint.docPath.replace(/\\/g, "/")}\`
- 현재 승격 후보:
  - ${promotionHint.nextTask}
`;
}

/**
 * [GPT미검증] 블록의 `변경 파일` 목록과 `Test Command`의 eslint 범위를 비교.
 * 테스트 파일이 변경 파일에 있지만 eslint 명령에 없으면 경고를 반환한다.
 */
function checkEslintCoverage(markdown) {
  const warnings = [];
  const h2Blocks = markdown.split(/(?=^## )/m);

  for (const block of h2Blocks) {
    if (!block.includes("[GPT미검증]")) continue;

    const headingMatch = block.match(/^## (.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : "(unknown)";

    // 변경 파일 섹션에서 경로 추출
    const changedFilesMatch = block.match(/### 변경 파일\n([\s\S]*?)(?=\n###|\n---|\n## |$)/);
    const changedFiles = changedFilesMatch
      ? [...changedFilesMatch[1].matchAll(/- `([^`]+)`/g)].map((m) => m[1])
      : [];

    // Test Command 섹션에서 eslint 줄 추출
    const testCmdMatch = block.match(/### Test Command\n[\s\S]*?```[^\n]*\n([\s\S]*?)```/);
    const eslintLine = testCmdMatch
      ? (testCmdMatch[1].split("\n").find((l) => /npx eslint/.test(l)) ?? "")
      : "";

    const eslintTokens = eslintLine.split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "npx" && t !== "eslint");
    const eslintSet = new Set(eslintTokens);

    const missing = changedFiles.filter((f) => !eslintSet.has(f));
    if (missing.length > 0) {
      warnings.push({ heading, missing });
    }
  }

  return warnings;
}

function buildPrompt(scopeText, promotionHint) {
  const template = readFileSync(promptTemplatePath, "utf8");
  const promotionSection = buildPromotionSection(promotionHint);
  return template
    .split("{{SCOPE}}").join(scopeText)
    .split("{{PROMOTION_SECTION}}").join(promotionSection);
}

function resolveCodexBin() {
  return resolveBinary("codex", "CODEX_BIN");
}

function determineResumeTarget(args) {
  if (args.resume === false) {
    return null;
  }

  if (args.sessionId) {
    return { type: "session", value: args.sessionId };
  }

  const saved = readSavedSession();
  if (saved) {
    return { type: "session", value: saved };
  }

  if (args.resumeLast) {
    return { type: "last", value: null };
  }

  return null;
}

function buildCodexArgs(args, resumeTarget) {
  const wantsFullAccess = args.sandbox === "danger-full-access";

  if (resumeTarget) {
    const base = ["exec", "resume"];

    if (args.model) {
      base.push("--model", args.model);
    }
    if (wantsFullAccess) {
      base.push("--dangerously-bypass-approvals-and-sandbox");
    }
    base.push("--json");

    if (resumeTarget.type === "last") {
      base.push("--last");
    } else {
      base.push(resumeTarget.value);
    }

    base.push("-");
    return base;
  }

  const base = [
    "exec",
    "-C",
    repoRoot,
  ];

  if (wantsFullAccess) {
    base.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    base.push("--sandbox", args.sandbox);
  }

  if (args.model) {
    base.push("--model", args.model);
  }
  if (args.json) {
    base.push("--json");
  } else {
    base.push("--json");
  }

  base.push("-");
  return base;
}

function emitCodexOutput(stdout, stderr, rawJson) {
  let threadId = null;
  let sawJson = false;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      sawJson = true;

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
      }

      if (rawJson) {
        console.log(line);
        continue;
      }

      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        console.log(event.item.text);
      }
    } catch {
      console.log(line);
    }
  }

  if (stderr?.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  return { threadId, sawJson };
}

function runRespond(args) {
  if (!args.sync && !args.pickNext && !args.autoFix) {
    return;
  }

  const respondArgs = [resolve(repoRoot, "scripts", "feedback-respond.mjs")];
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  if (!args.pickNext) {
    respondArgs.push("--no-sync-next");
  }

  const result = spawnSync(process.execPath, respondArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.resetSession) {
    deleteSavedSessionId();
  }

  if (!existsSync(claudePath)) {
    throw new Error(`Missing file: ${claudePath}`);
  }

  const claudeMd = readFileSync(claudePath, "utf8");

  // B: eslint 범위 일관성 사전 체크
  const eslintWarnings = checkEslintCoverage(claudeMd);
  if (eslintWarnings.length > 0) {
    console.warn("⚠ eslint 범위 불일치 — 감사 전 확인 권장:");
    for (const { heading, missing } of eslintWarnings) {
      console.warn(`  ${heading}`);
      for (const f of missing) {
        console.warn(`    누락: ${f}`);
      }
    }
    console.warn("");
  }

  if (!args.scope && !hasPendingItems(claudeMd)) {
    console.log("No [GPT미검증] or [계류] items in claude.md. Skipping audit.");
    runRespond(args);
    return;
  }

  const scopeText = args.scope ?? detectScope(claudeMd);
  const promotionHint = loadPromotionHint();
  const prompt = buildPrompt(scopeText, promotionHint);
  const codexBin = resolveCodexBin();

  if (args.dryRun) {
    if (args.debugBin) {
      console.log(`Resolved Codex executable: ${codexBin}`);
    }
    console.log(prompt);
    return;
  }

  const resumeTarget = determineResumeTarget(args);
  if (resumeTarget?.type === "session") {
    console.log(`Resuming audit session: ${resumeTarget.value}`);
  } else if (resumeTarget?.type === "last") {
    console.log("Resuming most recent Codex session in this repo.");
  } else {
    console.log("Starting a new audit session.");
  }

  const codexArgs = buildCodexArgs(args, resumeTarget);
  if (args.debugBin) {
    console.log(`Resolved Codex executable: ${codexBin}`);
  }
  const result = spawnResolved(codexBin, codexArgs, {
    cwd: repoRoot,
    input: prompt,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });

  const { threadId } = emitCodexOutput(result.stdout ?? "", result.stderr ?? "", args.json);

  if (result.error) {
    if (result.error instanceof Error && "code" in result.error && result.error.code === "ENOENT") {
      throw new Error(`Could not find Codex CLI. Set CODEX_BIN or ensure 'codex' is on PATH. Attempted: ${codexBin}`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (existsSync(gptPath)) {
    console.log(`\nUpdated: ${gptPath}`);
    const gptMd = readFileSync(gptPath, "utf8");
    if (!hasPendingItems(gptMd) && threadId) {
      deleteSavedSessionId();
      console.log("No remaining [계류] items — session reset for next audit.");
    } else if (threadId) {
      writeSavedSession(threadId);
      console.log(`Saved audit session: ${threadId}`);
    }
  } else if (threadId) {
    writeSavedSession(threadId);
    console.log(`Saved audit session: ${threadId}`);
  }

  runRespond(args);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`feedback-audit failed: ${message}`);
  process.exit(1);
}
