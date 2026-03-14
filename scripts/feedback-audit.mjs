#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
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

function readSavedSessionId() {
  if (!existsSync(sessionPath)) {
    return null;
  }

  const value = readFileSync(sessionPath, "utf8").trim();
  return value || null;
}

function writeSavedSessionId(sessionId) {
  mkdirSync(resolve(repoRoot, ".claude"), { recursive: true });
  writeFileSync(sessionPath, `${sessionId}\n`, "utf8");
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

function buildPrompt(scopeText, promotionHint) {
  const promotionSection = promotionHint ? `

합의 승격 규칙:
- 현재 감사 범위가 검증 후 모두 \`[합의완료]\`이면 \`## 다음 작업\`은 임의 생성하지 말고 아래 승격 후보를 그대로 사용하세요.
- 승격 후보 출처: \`${promotionHint.docPath.replace(/\\/g, "/")}\`
- 현재 승격 후보:
  - ${promotionHint.nextTask}
` : "";

  return `다음 감사 프로토콜로 동작하세요.

역할:
- 당신은 구현자가 아니라 감사자입니다.
- \`docs/feedback/claude.md\`의 완료 주장만 검토합니다.
- 반드시 코드와 테스트를 직접 확인한 뒤 판정합니다.
- 구현 추정이나 문서 추정으로 판정하지 마세요.

감사 범위:
${scopeText}

작업 절차:
1. \`docs/feedback/claude.md\`를 읽습니다.
2. 완료 주장과 근거 파일, 테스트 파일을 추출합니다.
3. 관련 코드를 직접 확인합니다.
4. 관련 lint와 테스트를 직접 실행합니다. 테스트가 없더라도 repo-appropriate lint는 생략하지 마세요.
   - lint 대상: 증거 패키지의 변경 파일(`src/**/*.ts`, `tests/**/*.ts`) 각각 `npx eslint <file>` 실행.
   - `src/**`와 `tests/**`의 eslint 규칙이 다를 수 있으므로 반드시 파일별로 분리 실행하세요.
   - lint exit code ≠ 0이면 즉시 `lint-gap [major]` + `구체 지점` (파일명:L{line} + 오류 메시지).
5. 판정을 \`docs/feedback/gpt.md\`에만 반영합니다.
6. 설계 문서(\`docs/ko/design/**\`, \`docs/en/design/**\`)는 수정하지 마세요.
7. 현재 범위 안에서 \`SOLID\`, \`YAGNI\`, \`DRY\`, \`KISS\`, \`LoD\` 5원칙 위반이 있는지도 함께 봅니다.

판정 규칙:
- \`완료\`: 코드, lint, 테스트(또는 테스트 부재 근거)로 닫힘
- \`부분 완료\`: 구현은 있으나 근거가 부족하거나 일부만 닫힘
- \`미완료\`: 주장과 코드가 불일치하거나 테스트가 없음
- 이미 \`[합의완료]\`인 이전 트랙은 재판정하지 말고 유지하세요.
- 이번 범위에 대해서만 \`[합의완료]\`, \`[계류]\`, \`[GPT미검증]\`를 갱신하세요.
- 이전에 \`[합의완료]\`였던 항목에서 후속 변경으로 회귀를 발견하면, 기본값은 기존 합의 이력을 지우지 말고 새 \`[계류]\` follow-up 항목으로 분리 등록하세요.
- 단, 회귀가 원래 완료 기준 자체를 직접 깨뜨리면 기존 \`[합의완료]\` 항목을 \`[계류]\`로 강등할 수 있습니다.
- \`docs/feedback/claude.md\`에 현재 범위의 증거 패키지(\`claim\`, \`changed files\`, \`test command\`, \`test result\`, \`residual risk\`)가 없거나 약하면 \`needs-evidence\`를 우선 사용하세요.
- \`lint\`가 실행되지 않았거나 실패했으면 \`[합의완료]\`로 올리지 말고 \`lint-gap\`을 우선 사용하세요.
- \`lint-gap\` 반려 시 \`## 구체 지점\`은 필수: 오류가 발생한 파일명:L{line}과 오류 메시지 전문을 인용하세요. "N건"만 쓰는 것은 허용하지 않습니다.
- 현재 범위에서 \`SOLID\`, \`YAGNI\`, \`DRY\`, \`KISS\`, \`LoD\` 위반이 구조적 회귀를 만들면 \`principle-drift\`를 사용하세요.
- \`[계류]\` 판정이면 \`## 반려 코드\`를 반드시 추가하고, 아래 코드 중 1~3개만 쓰세요:
  - \`needs-evidence\`
  - \`scope-mismatch\`
  - \`lint-gap\`
  - \`test-gap\`
  - \`claim-drift\`
  - \`principle-drift\`
- 반려 코드마다 심각도를 병기하세요: \`[major]\` 또는 \`[minor]\`.
  - \`[major]\`: 핵심 경로 미검증, 코드-주장 불일치, lint 실패 — 다음 라운드 \`[합의완료]\` 불가.
  - \`[minor]\`: 문서 오타/불일치, 비핵심 케이스 누락 — 수정 확인 후 다음 라운드 pass 허용.
- 반려 시 \`## 구체 지점\` 섹션을 추가하고, 각 반려 코드에 대해 \`파일명:섹션명\` 또는 \`파일명:L{line}\` 형태로 정확한 위치를 인용하세요. 추정이나 일반론 금지.
- 현재 범위가 \`[계류]\`이면 \`## 완료 기준 재고정\`에 "무엇이 닫혀야 다음 라운드에서 \`[합의완료]\`가 되는지"를 1줄로 반드시 쓰세요. 반복 계류면 더 구체화하세요.

테스트 충분성 체크리스트 (\`test-gap\` 판정 전 반드시 확인):
- retry / repair 로직: 성공 여부만이 아니라 **호출 횟수(call count)** 검증 테스트 존재 여부
- 결정론적 보장: **동수(tie) / 빈 입력 / 전체 실패** 경계 케이스 존재 여부
- 에러 경로: **에러 발생 케이스**를 직접 실행하는 테스트 존재 여부
- 문서-코드 정합성: \`residual risk\` 또는 \`claim\`의 설명이 **실제 코드 동작**과 일치하는지
- **Bonus Fix / 부가 수정**이 있으면 해당 메서드/함수를 직접 호출하는 전용 테스트가 증거 패키지에 포함되었는지 확인
- 위 항목 중 하나라도 누락이면 \`test-gap [major]\`, 문서 불일치만이면 \`claim-drift [minor]\`로 분리하세요.

답변 파일:
- \`docs/feedback/gpt.md\`

답변 형식:
- 길게 쓰지 말고 아래만 유지하세요.
  - 감사 범위
  - 독립 검증 결과
  - 최종 판정
  - 반려 코드 (심각도 포함: \`[major]\`/\`[minor]\`)
  - 구체 지점 (\`[계류]\`일 때만 — \`파일명:섹션\` 또는 \`파일명:L{line}\` 인용)
  - 핵심 근거 3~5줄
  - 완료 기준 재고정
  - 다음 작업
- \`## 개선된 프로토콜\` 섹션이 있으면 삭제하고 다시 만들지 마세요.
- 회귀 follow-up을 추가할 때는 예시처럼 분리하세요:
  - \`- [계류] Regression Follow-up / EV-R1 — 이후 변경으로 eval gate 회귀 발생\`

다음 작업 작성 규칙:
- \`## 다음 작업\`은 반드시 비워두지 마세요.
- 일반론 금지: \`별도 감사로 유지\`, \`계속 진행\`, \`후속 작업\` 같은 추상 문구만 쓰지 마세요.
- 현재 감사 범위가 \`[계류]\`이면, 같은 범위에서 가장 먼저 수정할 1개 작업을 쓰세요.
- 현재 감사 범위가 \`[합의완료]\`이면, \`docs/feedback/claude.md\`에서 다음 \`[GPT미검증]\` 또는 \`[계류]\` 항목 1개를 골라 쓰세요.
- 다음 작업에는 가능하면 번들/트랙 이름과 함께 정확한 파일, 경로, 테스트 타깃을 포함하세요.
- 예시 형식:
  - \`Bundle O4 / OB-8 Optional Exporter Ports — src/observability/* exporter 포트 추가, tests/observability/* exporter 테스트 작성\`
  - \`저장소 전체 멀티테넌트 closeout — src/dashboard/routes/chat.ts 의 /api/chat/mirror* ownership 검사 추가, tests/dashboard/chat-mirror-ownership.test.ts 작성\`
${promotionSection}

운영 원칙:
- 합의가 닫히기 전까지는 \`docs/feedback/*.md\`만 업데이트합니다.
- 설계 문서는 건드리지 않습니다.
- 테스트 숫자는 문서가 아니라 실제 재실행 결과를 기준으로 씁니다.
`;
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

  const saved = readSavedSessionId();
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

  if (threadId) {
    writeSavedSessionId(threadId);
    console.log(`Saved audit session: ${threadId}`);
  }

  if (existsSync(gptPath)) {
    console.log(`\nUpdated: ${gptPath}`);
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
