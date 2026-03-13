#!/usr/bin/env node

/**
 * GPT → Claude 방향: gpt.md의 판정을 claude.md에 자동 동기화.
 *
 * [합의완료] 항목은 직접 파일 수정으로 반영.
 * [계류] 항목은 보정 요청을 추출하여 claude -p로 처리.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const claudePath = resolve(repoRoot, "docs", "feedback", "claude.md");
const gptPath = resolve(repoRoot, "docs", "feedback", "gpt.md");

function usage() {
  console.log(`Usage: node scripts/feedback-respond.mjs [options]

Options:
  --auto-fix         Invoke claude -p for [계류] corrections
  --no-sync-next     Do not sync the "## 다음 작업" section from gpt.md
  --dry-run          Show changes without writing
  -h, --help         Show this help
`);
}

function parseArgs(argv) {
  const args = { autoFix: false, dryRun: false, syncNext: true };
  for (const arg of argv) {
    if (arg === "--auto-fix") args.autoFix = true;
    else if (arg === "--no-sync-next") args.syncNext = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** 감사 범위 + 최종 판정에서 상태 태그가 있는 항목을 추출 */
function parseStatusLines(markdown) {
  const items = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/\[(합의완료|계류|GPT미검증)\]/);
    if (!m) continue;
    // 상태 태그를 제거한 순수 항목 텍스트 (비교용 키)
    const key = line
      .replace(/`?\[(?:합의완료|계류|GPT미검증)\]`?/g, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/^[\s-]*/, "")
      .replace(/:\s*$/, "")
      .trim();
    items.push({ status: m[1], key, raw: line.trim() });
  }
  return items;
}

/** gpt.md의 [합의완료] 판정을 claude.md에 반영 */
function syncApproved(claudeMd, gptItems) {
  let updated = claudeMd;
  const synced = [];

  const approved = gptItems.filter(i => i.status === "합의완료");

  for (const gptItem of approved) {
    // claude.md에서 같은 항목이 [GPT미검증]인 행을 찾아 교체
    const escaped = gptItem.key
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      "(`?)\\[GPT미검증\\]\\1(.*?" + escaped + ")",
      "i",
    );
    if (re.test(updated)) {
      updated = updated.replace(re, "`[합의완료]`$2");
      synced.push(gptItem.key);
    }
  }

  return { updated, synced };
}

/** [계류] 항목의 보정 요청을 추출 */
function extractCorrections(gptMd, gptItems) {
  const verdictSection = readSection(gptMd, "최종 판정");
  const source = verdictSection ? verdictSection.lines.join("\n") : gptMd;
  const pending = parseStatusLines(source).filter((i) => i.status === "계류");
  if (pending.length === 0) return [];
  return [...new Set(pending.map((p) => p.key))];
}

function readSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()));
  if (start < 0) {
    return null;
  }
  const end = lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()));
  return {
    start,
    end: end >= 0 ? end : lines.length,
    lines: lines.slice(start, end >= 0 ? end : lines.length),
  };
}

function replaceSection(markdown, heading, replacementLines) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(markdown, heading);
  const replacement = [...replacementLines];

  if (section) {
    lines.splice(section.start, section.end - section.start, ...replacement);
    return `${lines.join("\n")}\n`;
  }

  const trimmed = markdown.replace(/\s*$/, "");
  return `${trimmed}\n\n${replacement.join("\n")}\n`;
}

function syncNextTask(claudeMd, gptMd) {
  const nextSection = readSection(gptMd, "다음 작업");
  if (!nextSection) {
    return { updated: claudeMd, changed: false };
  }

  const normalizedSource = nextSection.lines.join("\n").trim();
  const currentSection = readSection(claudeMd, "다음 작업");
  const normalizedCurrent = currentSection ? currentSection.lines.join("\n").trim() : "";

  if (normalizedSource === normalizedCurrent) {
    return { updated: claudeMd, changed: false };
  }

  return {
    updated: replaceSection(claudeMd, "다음 작업", nextSection.lines),
    changed: true,
  };
}

function buildFixPrompt(corrections, gptMd) {
  return `GPT 감사자가 다음 항목에 보정을 요청했습니다.

보정 대상:
${corrections.map(c => `- ${c}`).join("\n")}

GPT 피드백 원문 (docs/feedback/gpt.md):
${gptMd}

작업:
1. gpt.md의 보정 요청을 확인하세요.
2. 관련 코드를 수정하세요.
3. 테스트를 실행하여 통과를 확인하세요.
4. docs/feedback/claude.md를 갱신하세요 — 수정한 내용을 반영하고 상태를 [GPT미검증]으로 유지하세요.
5. 설계 문서(docs/ko/design/**, docs/en/design/**)는 수정하지 마세요.
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(gptPath)) {
    console.log("gpt.md not found — nothing to respond to.");
    return;
  }
  if (!existsSync(claudePath)) {
    throw new Error(`Missing: ${claudePath}`);
  }

  const gptMd = readFileSync(gptPath, "utf8");
  const claudeMd = readFileSync(claudePath, "utf8");

  const gptItems = parseStatusLines(gptMd);
  const claudeItems = parseStatusLines(claudeMd);
  const unverified = claudeItems.filter(i => i.status === "GPT미검증");

  let updated = claudeMd;
  const { updated: afterApproved, synced } = syncApproved(updated, gptItems);
  updated = afterApproved;

  if (synced.length > 0) {
    console.log(`Syncing ${synced.length} item(s) to [합의완료]:`);
    for (const s of synced) console.log(`  ✓ ${s}`);
  } else if (unverified.length === 0) {
    console.log("No [GPT미검증] items in claude.md.");
  }

  let nextChanged = false;
  if (args.syncNext) {
    const nextSync = syncNextTask(updated, gptMd);
    updated = nextSync.updated;
    nextChanged = nextSync.changed;
    if (nextChanged) {
      console.log("Synced '## 다음 작업' from gpt.md to claude.md.");
    }
  }

  if (updated !== claudeMd) {
    if (!args.dryRun) {
      writeFileSync(claudePath, updated, "utf8");
      console.log(`Updated: ${claudePath}`);
    } else {
      console.log("(dry-run — no file written)");
    }
  }

  const corrections = extractCorrections(gptMd, gptItems);
  if (corrections.length > 0) {
    console.log(`\n[계류] corrections needed (${corrections.length}):`);
    for (const c of corrections) console.log(`  ⚠ ${c}`);

    if (args.autoFix) {
      console.log("\nInvoking claude -p for corrections...");
      const prompt = buildFixPrompt(corrections, gptMd);
      const result = spawnResolved(resolveBinary("claude", "CLAUDE_BIN"), ["-p"], {
        cwd: repoRoot,
        input: prompt,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    } else {
      console.log("\nRun with --auto-fix to invoke claude -p for corrections.");
    }
  }

  if (synced.length === 0 && corrections.length === 0 && !nextChanged) {
    console.log("GPT has not yet responded to pending items.");
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`feedback-respond failed: ${message}`);
  process.exit(1);
}
