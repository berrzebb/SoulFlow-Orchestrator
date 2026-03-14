/** 마크다운 헤딩 기반 청킹 — memsearch 방식을 SQLite 환경에 적용. */

import { sha256_short } from "../utils/crypto.js";

export interface MemoryChunk {
  chunk_id: string;
  heading: string;
  heading_level: number;
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
}

const MAX_CHUNK_SIZE = 1500;
const OVERLAP_LINES = 2;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * 마크다운 텍스트를 헤딩 단위로 청크 분할.
 *
 * 1. 헤딩(# ~ ######)을 경계로 섹션 분할
 * 2. MAX_CHUNK_SIZE 초과 섹션은 단락(\n\n) 경계에서 재분할
 * 3. 각 청크에 SHA-256 composite hash 부여
 */
export function chunk_markdown(text: string, source_key: string): MemoryChunk[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const sections = split_by_heading(lines);
  const chunks: MemoryChunk[] = [];

  for (const section of sections) {
    if (section.content.length <= MAX_CHUNK_SIZE) {
      chunks.push(make_chunk(section, source_key));
    } else {
      const sub = split_by_paragraph(section, source_key);
      chunks.push(...sub);
    }
  }

  return chunks;
}

interface RawSection {
  heading: string;
  heading_level: number;
  start_line: number;
  end_line: number;
  content: string;
}

function split_by_heading(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection = {
    heading: "", heading_level: 0, start_line: 1, end_line: 1, content: "",
  };
  const buf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && buf.length > 0) {
      // 이전 섹션 마감
      current.content = buf.join("\n").trim();
      current.end_line = i; // 0-indexed → 1-indexed는 push 시 보정
      if (current.content) sections.push(current);
      buf.length = 0;

      current = {
        heading: m[2].trim(),
        heading_level: m[1].length,
        start_line: i + 1,
        end_line: i + 1,
        content: "",
      };
    }
    if (m && buf.length === 0 && current.content === "") {
      current.heading = m[2].trim();
      current.heading_level = m[1].length;
      current.start_line = i + 1;
    }
    buf.push(lines[i]);
  }

  // 마지막 섹션
  current.content = buf.join("\n").trim();
  current.end_line = lines.length;
  if (current.content) sections.push(current);

  return sections;
}

function split_by_paragraph(section: RawSection, source_key: string): MemoryChunk[] {
  const paragraphs = section.content.split(/\n{2,}/);
  const chunks: MemoryChunk[] = [];
  let buf: string[] = [];
  let buf_len = 0;
  let chunk_start = section.start_line;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    if (buf_len + para.length > MAX_CHUNK_SIZE && buf.length > 0) {
      // 현재 버퍼를 청크로 확정
      const content = buf.join("\n\n").trim();
      const line_count = content.split("\n").length;
      chunks.push(make_chunk({
        heading: section.heading,
        heading_level: section.heading_level,
        start_line: chunk_start,
        end_line: chunk_start + line_count - 1,
        content,
      }, source_key));

      // 오버랩: 마지막 OVERLAP_LINES줄을 다음 청크에 유지
      const overlap = content.split("\n").slice(-OVERLAP_LINES).join("\n");
      buf = overlap ? [overlap] : [];
      buf_len = overlap.length;
      chunk_start = chunk_start + line_count - OVERLAP_LINES;
    }

    buf.push(para);
    buf_len += para.length;
  }

  // 남은 버퍼
  if (buf.length > 0) {
    const content = buf.join("\n\n").trim();
    const line_count = content.split("\n").length;
    if (content) {
      chunks.push(make_chunk({
        heading: section.heading,
        heading_level: section.heading_level,
        start_line: chunk_start,
        end_line: chunk_start + line_count - 1,
        content,
      }, source_key));
    }
  }

  return chunks;
}

function make_chunk(section: RawSection, source_key: string): MemoryChunk {
  const content_hash = sha256_short(section.content);
  const chunk_id = sha256_short(
    `${source_key}:${section.start_line}:${section.end_line}:${content_hash}`,
  );
  return {
    chunk_id,
    heading: section.heading,
    heading_level: section.heading_level,
    start_line: section.start_line,
    end_line: section.end_line,
    content: section.content,
    content_hash,
  };
}

