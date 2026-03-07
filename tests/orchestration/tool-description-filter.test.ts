import { describe, it, expect } from "vitest";
import { filter_tool_sections } from "@src/orchestration/tool-description-filter.js";

const SAMPLE_DOC = [
  "# TOOLS.md",
  "도구 사용법 안내입니다.",
  "",
  "## 파일 시스템",
  "read_file, write_file 등",
  "",
  "## 코드 실행",
  "exec 도구로 셸 명령 실행",
  "",
  "## 웹",
  "web_search, web_fetch 도구",
  "",
  "## 메시지 / 파일 전송",
  "message, send_file 도구",
  "",
  "## 스케줄링",
  "cron 도구",
  "",
  "## 메모리",
  "memory 도구",
  "",
  "## 주의사항",
  "민감정보를 출력하지 마세요.",
  "",
  "## 커스텀 섹션",
  "매핑 없는 섹션입니다.",
].join("\n");

describe("filter_tool_sections", () => {
  it("빈 카테고리 → 전체 반환", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set());
    expect(result).toBe(SAMPLE_DOC);
  });

  it("filesystem 카테고리 → 파일 시스템 섹션 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem"]));
    expect(result).toContain("## 파일 시스템");
    expect(result).toContain("read_file, write_file");
  });

  it("filesystem 카테고리 → 코드 실행 섹션 제외", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem"]));
    expect(result).not.toContain("## 코드 실행");
    expect(result).not.toContain("exec 도구로 셸 명령 실행");
  });

  it("web 카테고리 → 웹 + HTTP 요청 섹션 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["web"]));
    expect(result).toContain("## 웹");
    expect(result).toContain("web_search");
  });

  it("주의사항 섹션은 항상 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem"]));
    expect(result).toContain("## 주의사항");
    expect(result).toContain("민감정보를 출력하지 마세요.");
  });

  it("매핑 없는 섹션은 안전하게 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem"]));
    expect(result).toContain("## 커스텀 섹션");
    expect(result).toContain("매핑 없는 섹션입니다.");
  });

  it("문서 헤더(## 이전 내용)는 항상 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["scheduling"]));
    expect(result).toContain("# TOOLS.md");
    expect(result).toContain("도구 사용법 안내입니다.");
  });

  it("scheduling 카테고리 → 스케줄링만 포함, 파일 시스템 제외", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["scheduling"]));
    expect(result).toContain("## 스케줄링");
    expect(result).toContain("cron 도구");
    expect(result).not.toContain("## 파일 시스템");
    expect(result).not.toContain("## 코드 실행");
  });

  it("여러 카테고리 동시 활성", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem", "memory"]));
    expect(result).toContain("## 파일 시스템");
    expect(result).toContain("## 메모리");
    expect(result).not.toContain("## 코드 실행");
    expect(result).not.toContain("## 스케줄링");
  });

  it("messaging + file_transfer → 메시지 / 파일 전송 포함", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["messaging"]));
    expect(result).toContain("## 메시지 / 파일 전송");
  });

  it("결과는 trim됨", () => {
    const result = filter_tool_sections(SAMPLE_DOC, new Set(["filesystem"]));
    expect(result).toBe(result.trim());
  });
});
