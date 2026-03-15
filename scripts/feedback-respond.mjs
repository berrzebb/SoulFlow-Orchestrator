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
const koExecutionOrderPath = resolve(repoRoot, "docs", "ko", "design", "improved", "execution-order.md");
const enExecutionOrderPath = resolve(repoRoot, "docs", "en", "design", "improved", "execution-order.md");
const koPromotionPath = resolve(repoRoot, "docs", "ko", "design", "improved", "feedback-promotion.md");
const enPromotionPath = resolve(repoRoot, "docs", "en", "design", "improved", "feedback-promotion.md");
const STATUS_TAG_RE = /\[(합의완료|계류|GPT미검증)(?:[^\]]*)\]/;
const STATUS_TAG_RE_GLOBAL = /`?\[(합의완료|계류|GPT미검증)(?:[^\]]*)\]`?/g;

function usage() {
  console.log(`Usage: node scripts/feedback-respond.mjs [options]

Options:
  --auto-fix         Invoke claude -p for [계류] corrections
  --gpt-only         Normalize only gpt.md / promotion docs and skip claude.md sync
  --no-sync-next     Do not normalize the "## 다음 작업" section in gpt.md
  --dry-run          Show changes without writing
  -h, --help         Show this help
`);
}

function parseArgs(argv) {
  const args = { autoFix: false, dryRun: false, syncNext: true, gptOnly: false };
  for (const arg of argv) {
    if (arg === "--auto-fix") args.autoFix = true;
    else if (arg === "--gpt-only") args.gptOnly = true;
    else if (arg === "--no-sync-next") args.syncNext = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) {
    return null;
  }

  const statuses = [...match[0].matchAll(/합의완료|계류|GPT미검증/g)].map((item) => item[0]);
  return statuses.at(-1) ?? null;
}

/** 감사 범위 + 최종 판정에서 상태 태그가 있는 항목을 추출 */
function parseStatusLines(markdown) {
  const items = [];
  for (const line of markdown.split(/\r?\n/)) {
    const status = extractStatusFromLine(line);
    if (!status) continue;
    // 상태 태그를 제거한 순수 항목 텍스트 (비교용 키)
    const key = line
      .replace(STATUS_TAG_RE_GLOBAL, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/^[\s-]*/, "")
      .replace(/:\s*$/, "")
      .trim();
    items.push({ status, key, raw: line.trim() });
  }
  return items;
}

function stripStatusFormatting(line) {
  return line
    .replace(STATUS_TAG_RE_GLOBAL, "")
    .replace(/^[\s#-]*/, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/:\s*$/, "")
    .trim();
}

/** gpt.md의 [합의완료] 판정을 claude.md에 반영 */
function syncApproved(claudeMd, gptMd) {
  let updated = claudeMd;
  const synced = [];

  const auditSection = readSection(gptMd, "감사 범위");
  const approvedScopeLines = (auditSection?.lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && extractStatusFromLine(line) === "합의완료");

  for (const scopeLine of approvedScopeLines) {
    const ids = collectIdsFromLine(scopeLine);
    if (ids.length === 0) {
      continue;
    }

    const label = stripStatusFormatting(scopeLine);
    const lines = updated.split(/\r?\n/);
    let localChange = false;

    for (let i = 0; i < lines.length; i++) {
      if (extractStatusFromLine(lines[i]) !== "GPT미검증") {
        continue;
      }
      const lineIds = collectIdsFromLine(lines[i]);
      if (lineIds.length === 0) {
        continue;
      }
      const sameItem = ids.every((id) => lineIds.includes(id));
      if (sameItem) {
        lines[i] = replaceStatusTag(lines[i], "합의완료");
        localChange = true;
      }
    }

    const anchorSection = readSection(lines.join("\n"), "합의완료");
    if (anchorSection) {
      const hasAnchor = anchorSection.lines.some((line) => {
        const lineIds = collectIdsFromLine(line);
        return ids.every((id) => lineIds.includes(id));
      });
      if (!hasAnchor) {
        let insertAt = anchorSection.end;
        while (insertAt > anchorSection.start && lines[insertAt - 1]?.trim() === "") {
          insertAt -= 1;
        }
        lines.splice(insertAt, 0, `- \`[합의완료]\` ${label}`);
        localChange = true;
      }
    }

    if (localChange) {
      updated = `${lines.join("\n")}\n`;
      synced.push(label);
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

function isEmptyMarker(line) {
  return /^`?(해당 없음|없음|none)`?$/i.test(line.trim());
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

function removeSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(markdown, heading);
  if (!section) {
    return markdown;
  }
  lines.splice(section.start, section.end - section.start);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "")}\n`;
}

function replaceStatusTag(line, status) {
  return line.replace(STATUS_TAG_RE, `[${status}]`);
}

function extractApprovedIdsFromSection(markdown, heading) {
  const section = readSection(markdown, heading);
  return section ? extractApprovedIds(section.lines.join("\n")) : new Set();
}

function mergeIdSets(...sets) {
  const merged = new Set();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}

function normalizeGptAuditScopeStatus(gptMd) {
  const auditSection = readSection(gptMd, "감사 범위");
  if (!auditSection) {
    return { updated: gptMd, changed: false };
  }

  const verdictApprovedIds = extractApprovedIdsFromSection(gptMd, "최종 판정");
  if (verdictApprovedIds.size === 0) {
    return { updated: gptMd, changed: false };
  }

  const replacementLines = auditSection.lines.map((line, index) => {
    if (index === 0) {
      return line;
    }
    const status = extractStatusFromLine(line);
    if (!status) {
      return line;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length === 0) {
      return line;
    }
    const isClosed = ids.every((id) => verdictApprovedIds.has(id));
    if (isClosed && !/\[합의완료\]/.test(line)) {
      return replaceStatusTag(line, "합의완료");
    }
    return line;
  });

  const updated = replaceSection(gptMd, "감사 범위", replacementLines);
  return { updated, changed: updated !== gptMd };
}

function normalizeResetCriteriaSection(gptMd) {
  const verdictSection = readSection(gptMd, "최종 판정");
  const verdictItems = verdictSection ? parseStatusLines(verdictSection.lines.join("\n")) : [];
  const hasPending = verdictItems.some((item) => item.status === "계류");
  const currentCriteria = readBulletSection(gptMd, "완료 기준 재고정");
  const hasMeaningfulCriteria = currentCriteria.some((line) => !isEmptyMarker(line));

  if (!hasPending || hasMeaningfulCriteria) {
    return { updated: gptMd, changed: false };
  }

  const rejectCodes = readBulletSection(gptMd, "반려 코드").filter((line) => !isEmptyMarker(line));
  const pendingLabels = verdictItems
    .filter((item) => item.status === "계류")
    .map((item) => stripStatusFormatting(item.raw).replace(/:\s*완료\s*\/?$/, "").trim());

  const focus = rejectCodes.length > 0
    ? rejectCodes.join(", ")
    : pendingLabels.join(", ") || "현재 계류 항목";

  const updated = replaceSection(gptMd, "완료 기준 재고정", [
    "## 완료 기준 재고정",
    "",
    `- 현재 범위는 \`${focus}\` 보정과 관련 lint/테스트 재통과가 확인되어야 \`[합의완료]\`로 승격한다.`,
  ]);

  return { updated, changed: updated !== gptMd };
}

function findNextAuditTaskInClaude(claudeMd, approvedIds = new Set()) {
  const auditSection = readSection(claudeMd, "감사 범위");
  const lines = auditSection ? auditSection.lines : claudeMd.split(/\r?\n/);

  for (const line of lines) {
    const status = extractStatusFromLine(line);
    if (status !== "GPT미검증" && status !== "계류") {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length > 0 && ids.every((id) => approvedIds.has(id))) {
      continue;
    }
    return trimmed.replace(/^- /, "").trim();
  }

  return null;
}

function findPendingVerdictTaskInGpt(gptMd) {
  const verdictSection = readSection(gptMd, "최종 판정");
  if (!verdictSection) {
    return null;
  }

  for (const line of verdictSection.lines) {
    if (extractStatusFromLine(line) !== "계류") {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    return stripStatusFormatting(trimmed.replace(/^- /, "").trim());
  }

  return null;
}

function findAdditionalTaskInGpt(gptMd) {
  const section = readSection(gptMd, "추가 작업");
  if (!section) {
    return null;
  }

  for (const line of section.lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    const value = trimmed.replace(/^- /, "").trim();
    if (isEmptyMarker(value)) {
      continue;
    }
    return value;
  }

  return null;
}

function normalizeAdditionalTasksSection(gptMd) {
  const section = readSection(gptMd, "추가 작업");
  if (!section) {
    return { updated: gptMd, changed: false };
  }

  const approvedIds = extractApprovedIdsFromSection(gptMd, "최종 판정");
  if (approvedIds.size === 0) {
    return { updated: gptMd, changed: false };
  }

  const keptLines = [section.lines[0]];
  for (const line of section.lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      keptLines.push(line);
      continue;
    }

    const ids = collectIdsFromLine(line);
    if (ids.length > 0 && ids.every((id) => approvedIds.has(id))) {
      continue;
    }

    keptLines.push(line);
  }

  const hasTask = keptLines.some((line, index) => {
    if (index === 0) return false;
    const trimmed = line.trim();
    return trimmed.startsWith("- ") && !isEmptyMarker(trimmed.replace(/^- /, "").trim());
  });

  const updated = hasTask
    ? replaceSection(gptMd, "추가 작업", keptLines)
    : removeSection(gptMd, "추가 작업");

  return { updated, changed: updated !== gptMd };
}

function syncGptNextTaskWithPromotion(gptMd, claudeMd, state) {
  const verdictSection = readSection(gptMd, "최종 판정");
  const verdictItems = verdictSection ? parseStatusLines(verdictSection.lines.join("\n")) : [];
  if (verdictItems.length === 0) {
    return { updated: gptMd, changed: false };
  }

  const additionalTask = findAdditionalTaskInGpt(gptMd);
  if (additionalTask) {
    const updated = replaceSection(gptMd, "다음 작업", [
      "## 다음 작업",
      "",
      `- ${additionalTask}`,
    ]);
    return { updated, changed: updated !== gptMd };
  }

  const pendingVerdictTask = findPendingVerdictTaskInGpt(gptMd);
  if (pendingVerdictTask) {
    const updated = replaceSection(gptMd, "다음 작업", [
      "## 다음 작업",
      "",
      `- \`${pendingVerdictTask}\``,
    ]);
    return { updated, changed: updated !== gptMd };
  }

  if (verdictItems.some((item) => item.status !== "합의완료")) {
    return { updated: gptMd, changed: false };
  }

  const approvedIds = resolvePromotionApprovedIds(claudeMd, gptMd);
  const activeAuditTask = findNextAuditTaskInClaude(claudeMd, approvedIds);
  const nextTask =
    state?.nextStage?.next_task_ko ??
    state?.nextStage?.next_task_en ??
    activeAuditTask ??
    "`현재 등록된 다음 작업 없음`";

  if (!nextTask) {
    return { updated: gptMd, changed: false };
  }

  const updated = replaceSection(gptMd, "다음 작업", [
    "## 다음 작업",
    "",
    `- ${nextTask}`,
  ]);

  return { updated, changed: updated !== gptMd };
}

function collectIdsFromLine(line) {
  const ids = new Set();
  const rangeRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\s*~\s*(?:\1-?)?(\d+)([A-Z]?)\b/g;
  let rangeMatch;
  while ((rangeMatch = rangeRe.exec(line)) !== null) {
    const prefix = rangeMatch[1];
    const start = Number(rangeMatch[2]);
    const startSuffix = rangeMatch[3] ?? "";
    const end = Number(rangeMatch[4]);
    const endSuffix = rangeMatch[5] ?? "";
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && startSuffix === endSuffix) {
      for (let i = start; i <= end; i++) {
        ids.add(`${prefix}-${i}${startSuffix}`);
      }
    }
  }

  const idRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\b/g;
  let idMatch;
  while ((idMatch = idRe.exec(line)) !== null) {
    ids.add(`${idMatch[1]}-${idMatch[2]}${idMatch[3] ?? ""}`);
  }

  // 단일 문자 접두사 ID: E1, E2, F3, G1 등 (dash 없이 숫자 직결)
  const singleRe = /\b([A-Z])(\d{1,2})\b/g;
  let singleMatch;
  while ((singleMatch = singleRe.exec(line)) !== null) {
    ids.add(`${singleMatch[1]}${singleMatch[2]}`);
  }

  return [...ids];
}

function extractApprovedIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== "합의완료") {
      continue;
    }
    for (const id of collectIdsFromLine(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function extractPendingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== "계류") {
      continue;
    }
    for (const id of collectIdsFromLine(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function resolvePromotionApprovedIds(claudeMd, gptMd) {
  const approved = mergeIdSets(
    extractApprovedIdsFromSection(claudeMd, "합의완료"),
    extractApprovedIdsFromSection(gptMd, "최종 판정"),
  );
  const downgraded = extractPendingIds(readSection(gptMd, "최종 판정")?.lines.join("\n") ?? "");
  for (const id of downgraded) {
    approved.delete(id);
  }
  return approved;
}

function loadPromotionPlan() {
  if (!existsSync(promotionPlanPath)) {
    return null;
  }
  return JSON.parse(readFileSync(promotionPlanPath, "utf8"));
}

function extractImprovedOrderSlugs(markdown) {
  const seen = new Set();
  const slugs = [];
  const re = /\]\(\.\/([a-z0-9-]+)\/README\.md\)/gi;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    const slug = match[1];
    if (slug === "feedback-promotion") continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function extractDocTitle(markdown) {
  const firstHeading = markdown.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (!firstHeading) return null;
  return firstHeading
    .replace(/^#\s+/, "")
    .replace(/^(설계|Design):\s*/i, "")
    .trim();
}

function extractOrderedIds(workBreakdownMd) {
  const lines = workBreakdownMd.split(/\r?\n/);
  const ordered = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!/^\d+\.\s+/.test(trimmed)) continue;
    for (const id of collectIdsFromLine(trimmed)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }

  if (ordered.length > 0) {
    return ordered;
  }

  for (const line of lines) {
    const match = line.match(/^##\s+([A-Z]{1,4}-\d+[A-Z]?)\b/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  return ordered;
}

function extractIdTitleMap(workBreakdownMd) {
  const map = new Map();
  for (const line of workBreakdownMd.split(/\r?\n/)) {
    const match = line.match(/^##\s+([A-Z]{1,4}-\d+[A-Z]?)\s+(.+?)\s*$/);
    if (!match) continue;
    map.set(match[1], match[2].trim());
  }
  return map;
}

function buildAutoNextTask(title, ids, titleMap, locale) {
  const labels = ids.map((id) => titleMap.get(id) ?? id);
  const idText = ids.join(" + ");
  if (locale === "en") {
    const actionText = labels.length > 1
      ? `close ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
      : `close ${labels[0]}`;
    return `\`${title} / ${idText} — ${actionText}\``;
  }
  const actionText = labels.length > 1
    ? `${labels.slice(0, -1).join(", ")}와 ${labels.at(-1)}를 닫기`
    : `${labels[0]}를 닫기`;
  return `\`${title} / ${idText} — ${actionText}\``;
}

function extractStageSlug(stage) {
  const ref = stage?.source_docs_ko?.[0] ?? stage?.source_docs_en?.[0] ?? "";
  const match = String(ref).match(/^\.\/([^/]+)\//);
  return match ? match[1] : null;
}

function deriveAutoPromotionStage(plan, approvedIds) {
  if (!existsSync(koExecutionOrderPath)) {
    return null;
  }

  const koOrderMd = readFileSync(koExecutionOrderPath, "utf8");
  const orderedSlugs = extractImprovedOrderSlugs(koOrderMd);
  const lastPlannedSlug = plan?.stages?.length ? extractStageSlug(plan.stages.at(-1)) : null;
  const startIndex = lastPlannedSlug ? orderedSlugs.indexOf(lastPlannedSlug) + 1 : 0;
  const candidateSlugs = startIndex > 0 ? orderedSlugs.slice(startIndex) : orderedSlugs;

  for (const slug of candidateSlugs) {
    const koReadmePath = resolve(repoRoot, "docs", "ko", "design", "improved", slug, "README.md");
    const enReadmePath = resolve(repoRoot, "docs", "en", "design", "improved", slug, "README.md");
    const koWbsPath = resolve(repoRoot, "docs", "ko", "design", "improved", slug, "work-breakdown.md");
    const enWbsPath = resolve(repoRoot, "docs", "en", "design", "improved", slug, "work-breakdown.md");

    if (!existsSync(koWbsPath)) {
      continue;
    }

    const koWbsMd = readFileSync(koWbsPath, "utf8");
    const orderedIds = extractOrderedIds(koWbsMd);
    if (orderedIds.length === 0) {
      continue;
    }

    const remainingIds = orderedIds.filter((id) => !approvedIds.has(id));
    if (remainingIds.length === 0) {
      continue;
    }

    const nextIds = remainingIds.slice(0, Math.min(2, remainingIds.length));
    const koTitleMap = extractIdTitleMap(koWbsMd);
    const enWbsMd = existsSync(enWbsPath) ? readFileSync(enWbsPath, "utf8") : "";
    const enTitleMap = enWbsMd ? extractIdTitleMap(enWbsMd) : new Map();
    const koTitle = existsSync(koReadmePath) ? (extractDocTitle(readFileSync(koReadmePath, "utf8")) ?? slug) : slug;
    const enTitle = existsSync(enReadmePath) ? (extractDocTitle(readFileSync(enReadmePath, "utf8")) ?? koTitle) : koTitle;

    return {
      id: `auto:${slug}`,
      agree_ids: nextIds,
      agreed_label_ko: `\`${koTitle} (${nextIds.join(" + ")})\``,
      agreed_label_en: `\`${enTitle} (${nextIds.join(" + ")})\``,
      next_task_ko: buildAutoNextTask(koTitle, nextIds, koTitleMap, "ko"),
      next_task_en: buildAutoNextTask(enTitle, nextIds, enTitleMap.size > 0 ? enTitleMap : koTitleMap, "en"),
      source_docs_ko: [`./${slug}/README.md`, `./${slug}/work-breakdown.md`],
      source_docs_en: [`./${slug}/README.md`, `./${slug}/work-breakdown.md`],
    };
  }

  return null;
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

  if (nextStage === null) {
    nextStage = deriveAutoPromotionStage(plan, approvedIds);
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
        "이 문서는 `feedback-promotion.plan.json`, 현재 `docs/feedback/gpt.md` 판정,",
        "그리고 `docs/feedback/claude.md`의 `## 합의완료` 앵커를 바탕으로",
        "**자동 생성**된다.",
      ]
    : [
        "## Purpose",
        "",
        "When the current audit track in `docs/feedback/*.md` is fully closed as `[agreed]`,",
        "the next work item is promoted automatically from this document instead of being written ad hoc.",
        "",
        "This document is **generated automatically** from `feedback-promotion.plan.json`,",
        "the current verdicts in `docs/feedback/gpt.md`, and the `## 합의완료` anchor",
        "inside `docs/feedback/claude.md`.",
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

  const claudeMd = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
  const approvedIds = resolvePromotionApprovedIds(claudeMd, gptMd);
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

function syncDemotedAnchors(claudeMd, gptMd) {
  const section = readSection(claudeMd, "합의완료");
  if (!section) {
    return { updated: claudeMd, removed: [] };
  }

  const downgradedIds = extractPendingIds(readSection(gptMd, "최종 판정")?.lines.join("\n") ?? "");
  if (downgradedIds.size === 0) {
    return { updated: claudeMd, removed: [] };
  }

  const lines = claudeMd.split(/\r?\n/);
  const removed = [];
  const replacement = section.lines.filter((line, index) => {
    if (index === 0) {
      return true;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length === 0) {
      return true;
    }
    const shouldRemove = ids.every((id) => downgradedIds.has(id));
    if (shouldRemove) {
      removed.push(stripStatusFormatting(line));
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    return { updated: claudeMd, removed };
  }

  return {
    updated: replaceSection(claudeMd, "합의완료", replacement),
    removed,
  };
}

function buildFixPrompt(corrections, gptMd) {
  const rejectCodes = readBulletSection(gptMd, "반려 코드");
  const resetCriteria = readBulletSection(gptMd, "완료 기준 재고정");
  const nextTasks = readBulletSection(gptMd, "다음 작업");

  return `GPT 감사자가 다음 항목에 보정을 요청했습니다.

보정 대상:
${corrections.map(c => `- ${c}`).join("\n")}

반려 코드:
${rejectCodes.length > 0 ? rejectCodes.map((code) => `- ${code}`).join("\n") : "- 없음"}

완료 기준 재고정:
${resetCriteria.length > 0 ? resetCriteria.map((line) => `- ${line}`).join("\n") : "- 없음"}

다음 작업:
${nextTasks.length > 0 ? nextTasks.map((line) => `- ${line}`).join("\n") : "- 없음"}

GPT 피드백 원문 (docs/feedback/gpt.md):
${gptMd}

작업:
1. gpt.md의 보정 요청을 확인하세요.
2. 보정 대상과 무관한 범위 확장 주장은 섞지 마세요. 범위 밖 작업은 분리하세요.
3. 관련 코드를 수정하세요. 수정은 항상 \`SOLID\`, \`YAGNI\`, \`DRY\`, \`KISS\`, \`LoD\` 5원칙을 현재 범위 안에서 지키는 방향이어야 합니다.
4. repo-appropriate lint를 반드시 먼저 실행하고 통과시키세요. 테스트가 있으면 함께 실행하세요.
5. docs/feedback/claude.md를 갱신하세요. 현재 라운드 항목은 [GPT미검증]으로 유지하고, 아래 5칸 증거 팩 형식을 따르세요:
   - claim
   - changed files
   - test command  (lint 명령 포함 필수)
   - test result   (lint 통과 여부 포함 필수)
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
  if (!existsSync(claudePath) && !args.gptOnly) {
    throw new Error(`Missing: ${claudePath}`);
  }

  let gptMd = readFileSync(gptPath, "utf8");
  const claudeMd = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";

  const withoutProtocolSection = removeSection(gptMd, "개선된 프로토콜");
  if (withoutProtocolSection !== gptMd) {
    gptMd = withoutProtocolSection;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log("Removed deprecated '## 개선된 프로토콜' section from gpt.md.");
    } else {
      console.log("(dry-run) would remove deprecated '## 개선된 프로토콜' section from gpt.md.");
    }
  }

  const auditScopeSync = normalizeGptAuditScopeStatus(gptMd);
  if (auditScopeSync.changed) {
    gptMd = auditScopeSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log("Normalized audit-scope status tags in gpt.md.");
    } else {
      console.log("(dry-run) would normalize audit-scope status tags in gpt.md.");
    }
  }

  const resetCriteriaSync = normalizeResetCriteriaSection(gptMd);
  if (resetCriteriaSync.changed) {
    gptMd = resetCriteriaSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log("Normalized '## 완료 기준 재고정' in gpt.md for pending verdicts.");
    } else {
      console.log("(dry-run) would normalize '## 완료 기준 재고정' in gpt.md for pending verdicts.");
    }
  }

  const additionalTasksSync = normalizeAdditionalTasksSection(gptMd);
  if (additionalTasksSync.changed) {
    gptMd = additionalTasksSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log("Normalized '## 추가 작업' in gpt.md by removing already agreed items.");
    } else {
      console.log("(dry-run) would normalize '## 추가 작업' in gpt.md by removing already agreed items.");
    }
  }

  const gptItems = parseStatusLines(gptMd);
  const claudeItems = parseStatusLines(claudeMd);
  const unverified = claudeItems.filter(i => i.status === "GPT미검증");

  let updated = claudeMd;
  const demotionSync = syncDemotedAnchors(updated, gptMd);
  updated = demotionSync.updated;
  if (demotionSync.removed.length > 0) {
    console.log(`Removing ${demotionSync.removed.length} downgraded item(s) from claude.md agreed anchor:`);
    for (const item of demotionSync.removed) console.log(`  ↺ ${item}`);
  }
  const { updated: afterApproved, synced } = syncApproved(updated, gptMd);
  updated = afterApproved;

  if (synced.length > 0) {
    console.log(`Syncing ${synced.length} item(s) to [합의완료]:`);
    for (const s of synced) console.log(`  ✓ ${s}`);
  } else if (unverified.length === 0) {
    console.log("No [GPT미검증] items in claude.md.");
  }

  const claudeWithoutNextTask = removeSection(updated, "다음 작업");
  if (claudeWithoutNextTask !== updated) {
    updated = claudeWithoutNextTask;
    console.log(args.dryRun
      ? "(dry-run) would remove deprecated '## 다음 작업' section from claude.md."
      : "Removed deprecated '## 다음 작업' section from claude.md.");
  }

  if (updated !== claudeMd) {
    if (!args.dryRun) {
      writeFileSync(claudePath, updated, "utf8");
      console.log(`Updated: ${claudePath}`);
    } else {
      console.log("(dry-run — no file written)");
    }
  }

  const effectiveClaudeMd = updated;
  const promotionPlan = loadPromotionPlan();
  const promotionState = promotionPlan
    ? computePromotionState(
        promotionPlan,
        resolvePromotionApprovedIds(effectiveClaudeMd, gptMd),
      )
    : null;

  if (args.syncNext) {
    const gptNextSync = syncGptNextTaskWithPromotion(gptMd, effectiveClaudeMd, promotionState);
    if (gptNextSync.changed) {
      gptMd = gptNextSync.updated;
      if (!args.dryRun) {
        writeFileSync(gptPath, gptMd, "utf8");
        console.log("Normalized '## 다음 작업' in gpt.md from promotion state.");
      } else {
        console.log("(dry-run) would normalize '## 다음 작업' in gpt.md from promotion state.");
      }
    }
  }

  const promotionChanged = syncPromotionDocs(gptMd, args);
  if (promotionChanged.length > 0) {
    console.log("\nUpdated improved promotion docs:");
    for (const file of promotionChanged) {
      console.log(`  ✓ ${file}`);
    }
  }

  if (args.gptOnly) {
    if (promotionChanged.length === 0) {
      console.log("GPT-only sync complete.");
    }
    return;
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

  if (synced.length === 0 && corrections.length === 0 && promotionChanged.length === 0) {
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
