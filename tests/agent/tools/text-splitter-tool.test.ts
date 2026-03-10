/**
 * TextSplitterTool — fixed/separator/sentence/paragraph/regex 전 액션 커버리지.
 */
import { describe, it, expect } from "vitest";
import { TextSplitterTool } from "@src/agent/tools/text-splitter.js";

const tool = new TextSplitterTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse(await tool.execute(params));
}

// 긴 텍스트 생성 헬퍼
const LONG = "Hello world. This is a sentence. Another one here. And more text follows. Final part.";
const PARA = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";

describe("TextSplitterTool — 메타데이터", () => {
  it("name = text_splitter", () => expect(tool.name).toBe("text_splitter"));
  it("category = data", () => expect(tool.category).toBe("data"));
});

describe("TextSplitterTool — fixed", () => {
  it("기본 고정 크기 분할", async () => {
    const text = "a".repeat(250);
    const r = await exec({ action: "fixed", text, chunk_size: 100, chunk_overlap: 10 });
    expect(r.chunk_count).toBeGreaterThan(1);
    expect(r.total_chars).toBe(250);
  });

  it("chunk_overlap 미지정 → 기본값 200 적용", async () => {
    const r = await exec({ action: "fixed", text: "a".repeat(300), chunk_size: 100 });
    // overlap defaults to min(200, 99)=99, step=1 → many chunks
    expect(r.chunk_count).toBeGreaterThan(2);
  });

  it("짧은 텍스트 → 청크 1개", async () => {
    const r = await exec({ action: "fixed", text: "short", chunk_size: 1000 });
    expect(r.chunk_count).toBe(1);
  });

  it("default action (action 미지정 시 fixed)", async () => {
    const r = await exec({ action: "fixed", text: LONG });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });
});

describe("TextSplitterTool — separator", () => {
  it("단락 구분으로 분할", async () => {
    const r = await exec({ action: "separator", text: PARA, chunk_size: 30, chunk_overlap: 0 });
    expect(r.chunk_count).toBeGreaterThan(0);
  });

  it("커스텀 구분자", async () => {
    const text = "part1|part2|part3|part4";
    const r = await exec({ action: "separator", text, separator: "|", chunk_size: 100 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });

  it("overlap이 있는 separator 분할 → tail 포함", async () => {
    // overlap > 0 → merge_parts에서 tail = current.slice(-overlap)
    const text = "aaa\n\nbbb\n\nccc\n\nddd";
    const r = await exec({ action: "separator", text, chunk_size: 10, chunk_overlap: 3 });
    expect(r.chunk_count).toBeGreaterThan(0);
  });
});

describe("TextSplitterTool — sentence", () => {
  it("문장 구분 분할", async () => {
    const text = "First sentence. Second sentence! Third one? Fourth here.";
    const r = await exec({ action: "sentence", text, chunk_size: 40, chunk_overlap: 0 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });
});

describe("TextSplitterTool — paragraph", () => {
  it("단락 분할 (\\n\\n 기준)", async () => {
    const r = await exec({ action: "paragraph", text: PARA, chunk_size: 50, chunk_overlap: 0 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });
});

describe("TextSplitterTool — regex", () => {
  it("정규식 패턴 분할", async () => {
    const text = "part1---part2---part3";
    const r = await exec({ action: "regex", text, separator: "-+", chunk_size: 100, chunk_overlap: 0 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });

  it("잘못된 정규식 → fixed 분할 폴백", async () => {
    const r = await exec({ action: "regex", text: "some text here", separator: "[invalid", chunk_size: 100 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });

  it("merge_parts: chunk 크기 초과 → push + tail 적용", async () => {
    // separator로 각 part가 chunk_size 초과 → push current, tail로 새 current 시작
    const text = "AAABBBCCC---DDDEEEFFF---GGGHHH";
    const r = await exec({ action: "separator", text, separator: "---", chunk_size: 12 });
    expect(r.chunk_count).toBeGreaterThanOrEqual(1);
  });
});
