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
const promotionPlanPath = resolve(repoRoot, "docs", "ko", "design", "improved", "feedback-promotion.plan.json");
const koPromotionPath = resolve(repoRoot, "docs", "ko", "design", "improved", "feedback-promotion.md");
const enPromotionPath = resolve(repoRoot, "docs", "en", "design", "improved", "feedback-promotion.md");

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

function readBulletSection(markdown, heading) {
  const section = readSection(markdown, heading);
  if (!section) {
    return [];
  }
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
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

function collectIdsFromLine(line) {
  const ids = new Set();
  const rangeRe = /\b([A-Z]{2,})-(\d+)\s*~\s*(?:\1-?)?(\d+)\b/g;
  let rangeMatch;
  while ((rangeMatch = rangeRe.exec(line)) !== null) {
    const prefix = rangeMatch[1];
    const start = Number(rangeMatch[2]);
    const end = Number(rangeMatch[3]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      for (let i = start; i <= end; i++) {
        ids.add(`${prefix}-${i}`);
      }
    }
  }

  const idRe = /\b([A-Z]{2,})-(\d+)\b/g;
  let idMatch;
  while ((idMatch = idRe.exec(line)) !== null) {
    ids.add(`${idMatch[1]}-${idMatch[2]}`);
  }

  return [...ids];
}

function extractApprovedIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.includes("[합의완료]")) {
      continue;
    }
    for (const id of collectIdsFromLine(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function loadPromotionPlan() {
  if (!existsSync(promotionPlanPath)) {
    return null;
  }
  return JSON.parse(readFileSync(promotionPlanPath, "utf8"));
}

function computePromotionState(plan, approvedIds) {
  const agreedStages = [];
  let nextStage = null;

  for (const stage of plan.stages ?? []) {
    const requiredIds = Array.isArray(stage.agree_ids) ? stage.agree_ids : [];
    const complete = requiredIds.length > 0 && requiredIds.every((id) => approvedIds.has(id));
    if (complete && nextStage === null) {
      agreedStages.push(stage);
      continue;
    }
    if (nextStage === null) {
      nextStage = stage;
    }
  }

  return { agreedStages, nextStage };
}

function renderPromotionDoc(locale, state) {
  const isKo = locale === "ko";
  const title = isKo ? "# 피드백 승격 인덱스" : "# Feedback Promotion Index";
  const meta = isKo
    ? "> 상태: `active` | 유형: 피드백 루프 승격 기준 | 생성: `scripts/feedback-respond.mjs`"
    : "> Status: `active` | Type: feedback-loop promotion rule | Generated by: `scripts/feedback-respond.mjs`";
  const purpose = isKo
    ? [
        "## 목적",
        "",
        "`docs/feedback/*.md`의 현재 감사 트랙이 완전히 `[합의완료]`로 닫히면,",
        "다음 작업은 임의로 쓰지 않고 이 문서에서 자동 승격한다.",
        "",
        "이 문서는 `feedback-promotion.plan.json`과 현재 `docs/feedback/gpt.md` 판정을 바탕으로",
        "**자동 생성**된다.",
      ]
    : [
        "## Purpose",
        "",
        "When the current audit track in `docs/feedback/*.md` is fully closed as `[agreed]`,",
        "the next work item is promoted automatically from this document instead of being written ad hoc.",
        "",
        "This document is **generated automatically** from `feedback-promotion.plan.json` plus",
        "the current verdicts in `docs/feedback/gpt.md`.",
      ];
  const rule = isKo
    ? [
        "## 사용 규칙",
        "",
        "- 현재 감사 범위가 모두 `[합의완료]`이면 `docs/feedback/gpt.md`의 `## 다음 작업`은 이 문서의 `## 현재 승격 대상` 첫 항목을 사용한다.",
        "- `docs/feedback/*.md`에 남아 있는 별도 `[계류]` 감사 항목은, 이미 합의된 트랙의 다음 improved 작업 승격을 자동으로 막지 않는다.",
      ]
    : [
        "## Usage Rule",
        "",
        "- If the current audited scope is fully agreed, `docs/feedback/gpt.md` should use the first item under `## Current Promotion Target` as `## Next Task`.",
        "- Residual `[pending]` audit items in `docs/feedback/*.md` do not automatically block promotion of the next improved work item for an already agreed track.",
      ];

  const agreedHeading = isKo ? "## 현재 합의된 트랙" : "## Currently Agreed Tracks";
  const agreedLines = state.agreedStages.length > 0
    ? state.agreedStages.map((stage) => `- ${isKo ? stage.agreed_label_ko : stage.agreed_label_en}`)
    : [isKo ? "- 없음" : "- none"];

  const targetHeading = isKo ? "## 현재 승격 대상" : "## Current Promotion Target";
  const targetLines = state.nextStage
    ? [`- ${isKo ? state.nextStage.next_task_ko : state.nextStage.next_task_en}`]
    : [isKo ? "- 현재 승격할 다음 작업 없음" : "- no remaining promotion target"];

  const sourceHeading = isKo ? "## 근거 문서" : "## Source Documents";
  const sourceDocs = state.nextStage
    ? (isKo ? state.nextStage.source_docs_ko : state.nextStage.source_docs_en) ?? []
    : [];
  const sourceLines = sourceDocs.length > 0
    ? sourceDocs.map((doc) => `- [${doc.replace(/^\.\//, "")}](${doc})`)
    : [isKo ? "- 없음" : "- none"];

  return [
    title,
    "",
    meta,
    "",
    ...purpose,
    "",
    ...rule,
    "",
    agreedHeading,
    "",
    ...agreedLines,
    "",
    targetHeading,
    "",
    ...targetLines,
    "",
    sourceHeading,
    "",
    ...sourceLines,
    "",
  ].join("\n");
}

function syncPromotionDocs(gptMd, args) {
  const plan = loadPromotionPlan();
  if (!plan) {
    return [];
  }

  const approvedIds = extractApprovedIds(gptMd);
  const state = computePromotionState(plan, approvedIds);
  const outputs = [
    { path: koPromotionPath, content: renderPromotionDoc("ko", state) },
    { path: enPromotionPath, content: renderPromotionDoc("en", state) },
  ];

  const changed = [];
  for (const output of outputs) {
    const current = existsSync(output.path) ? readFileSync(output.path, "utf8") : "";
    if (current === output.content) {
      continue;
    }
    changed.push(output.path);
    if (!args.dryRun) {
      writeFileSync(output.path, output.content, "utf8");
    }
  }

  return changed;
}

function buildFixPrompt(corrections, gptMd) {
  const rejectCodes = readBulletSection(gptMd, "반려 코드");
  const resetCriteria = readBulletSection(gptMd, "완료 기준 재고정");
  const protocolRules = readBulletSection(gptMd, "개선된 프로토콜");
  const nextTasks = readBulletSection(gptMd, "다음 작업");

  return `GPT 감사자가 다음 항목에 보정을 요청했습니다.

보정 대상:
${corrections.map(c => `- ${c}`).join("\n")}

반려 코드:
${rejectCodes.length > 0 ? rejectCodes.map((code) => `- ${code}`).join("\n") : "- 없음"}

완료 기준 재고정:
${resetCriteria.length > 0 ? resetCriteria.map((line) => `- ${line}`).join("\n") : "- 없음"}

현재 프로토콜:
${protocolRules.length > 0 ? protocolRules.map((line) => `- ${line}`).join("\n") : "- docs/feedback/gpt.md 기준 유지"}

다음 작업:
${nextTasks.length > 0 ? nextTasks.map((line) => `- ${line}`).join("\n") : "- 없음"}

GPT 피드백 원문 (docs/feedback/gpt.md):
${gptMd}

작업:
1. gpt.md의 보정 요청을 확인하세요.
2. 보정 대상과 무관한 범위 확장 주장은 섞지 마세요. 범위 밖 작업은 분리하세요.
3. 관련 코드를 수정하세요.
4. 테스트를 실행하여 통과를 확인하세요.
5. docs/feedback/claude.md를 갱신하세요. 현재 라운드 항목은 [GPT미검증]으로 유지하고, 아래 5칸 증거 팩 형식을 따르세요:
   - claim
   - changed files
   - test command
   - test result
   - residual risk
6. 설계 문서(docs/ko/design/**, docs/en/design/**)는 수정하지 마세요.
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

  const promotionChanged = syncPromotionDocs(gptMd, args);
  if (promotionChanged.length > 0) {
    console.log("\nUpdated improved promotion docs:");
    for (const file of promotionChanged) {
      console.log(`  ✓ ${file}`);
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

  if (synced.length === 0 && corrections.length === 0 && !nextChanged && promotionChanged.length === 0) {
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
