/** TOOLS.md 섹션 필터: 활성 도구 카테고리에 해당하는 섹션만 추출. */

import type { ToolCategory } from "./tool-selector.js";

/** TOOLS.md `## 제목` → ToolCategory 매핑. */
const SECTION_CATEGORIES: Record<string, ToolCategory[]> = {
  "파일 시스템": ["filesystem"],
  "코드 실행": ["shell"],
  "웹": ["web"],
  "HTTP 요청": ["web"],
  "메시지 / 파일 전송": ["messaging", "file_transfer"],
  "서브에이전트": ["spawn", "admin"],
  "스케줄링": ["scheduling"],
  "메모리": ["memory"],
  "보안": ["secret"],
  "정책": ["decision", "promise"],
  "워크플로우": ["external"],
  "다이어그램": ["diagram"],
  "런타임 관리": ["admin"],
};

/** 항상 포함되는 섹션 (보안 주의사항 등). */
const ALWAYS_SECTIONS = new Set(["주의사항"]);

/**
 * TOOLS.md를 `## 섹션` 단위로 파싱하여, 활성 카테고리에 해당하는 섹션만 반환.
 *
 * - `## 제목` 이전 내용(문서 헤더)은 항상 포함
 * - SECTION_CATEGORIES에 매핑 없는 섹션 → 누락 방지를 위해 포함
 * - ALWAYS_SECTIONS에 포함된 섹션 → 항상 포함
 * - active_categories가 비어 있으면 전체 반환 (폴백)
 */
export function filter_tool_sections(
  content: string,
  active_categories: ReadonlySet<string>,
): string {
  if (active_categories.size === 0) return content;

  const lines = content.split("\n");
  const output: string[] = [];
  let include = true;
  let buffer: string[] = [];

  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      if (include && buffer.length > 0) output.push(...buffer);
      buffer = [line];
      const section = m[1].trim();
      if (ALWAYS_SECTIONS.has(section)) {
        include = true;
      } else {
        const cats = SECTION_CATEGORIES[section];
        // 매핑 없는 섹션 → 안전하게 포함
        include = !cats || cats.some((c) => active_categories.has(c));
      }
    } else {
      buffer.push(line);
    }
  }
  if (include && buffer.length > 0) output.push(...buffer);

  return output.join("\n").trim();
}
