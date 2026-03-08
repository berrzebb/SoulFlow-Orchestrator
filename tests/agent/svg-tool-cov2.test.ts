/**
 * SvgTool — 미커버 분기 보충.
 * group 액션, chart line/title, unknown action, invalid chart data.
 */
import { describe, it, expect } from "vitest";
import { SvgTool } from "@src/agent/tools/svg.js";

const tool = new SvgTool({ secret_vault: undefined as never });

// ══════════════════════════════════════════
// group — 자식 요소 그루핑
// ══════════════════════════════════════════

describe("SvgTool — group", () => {
  it("자식 배열 → <g> 태그로 묶음", async () => {
    const children = JSON.stringify([
      '<rect x="0" y="0" width="10" height="10"/>',
      '<circle cx="5" cy="5" r="3"/>',
    ]);
    const r = JSON.parse(await tool.execute({ action: "group", children }));
    expect(r.svg).toContain("<g>");
    expect(r.svg).toContain("<rect");
    expect(r.svg).toContain("<circle");
    expect(r.svg).toContain("</g>");
  });

  it("빈 자식 → 빈 <g> 태그", async () => {
    const r = JSON.parse(await tool.execute({ action: "group", children: "[]" }));
    expect(r.svg).toContain("<g>");
    expect(r.svg).toContain("</g>");
  });

  it("children 생략 → 빈 <g> 태그 (default)", async () => {
    const r = JSON.parse(await tool.execute({ action: "group" }));
    expect(r.svg).toContain("<g>");
  });

  it("invalid JSON children → 빈 <g> (에러 격리)", async () => {
    const r = JSON.parse(await tool.execute({ action: "group", children: "not-json" }));
    expect(r.svg).toContain("<g>");
  });
});

// ══════════════════════════════════════════
// chart — line 타입
// ══════════════════════════════════════════

describe("SvgTool — chart: line 타입", () => {
  it("line 차트 생성 → polyline 포함", async () => {
    const data = JSON.stringify([
      { label: "Jan", value: 10 },
      { label: "Feb", value: 25 },
      { label: "Mar", value: 15 },
    ]);
    const r = JSON.parse(await tool.execute({ action: "chart", chart_type: "line", data }));
    expect(r.svg).toContain("<polyline");
    expect(r.svg).toContain("<circle");
    expect(r.chart_type).toBe("line");
    expect(r.data_points).toBe(3);
  });

  it("line 차트 + title → 제목 텍스트 포함", async () => {
    const data = JSON.stringify([
      { label: "Q1", value: 100 },
      { label: "Q2", value: 200 },
    ]);
    const r = JSON.parse(await tool.execute({
      action: "chart",
      chart_type: "line",
      data,
      title: "분기별 매출",
    }));
    expect(r.svg).toContain("분기별 매출");
    expect(r.svg).toContain("<polyline");
  });

  it("line 차트 데이터 1개 (단일 점)", async () => {
    const data = JSON.stringify([{ label: "Only", value: 50 }]);
    const r = JSON.parse(await tool.execute({ action: "chart", chart_type: "line", data }));
    expect(r.svg).toContain("<svg");
    expect(r.data_points).toBe(1);
  });
});

// ══════════════════════════════════════════
// chart — bar + title
// ══════════════════════════════════════════

describe("SvgTool — chart: bar + title", () => {
  it("bar 차트 + title → 제목 텍스트 포함", async () => {
    const data = JSON.stringify([{ label: "A", value: 10 }, { label: "B", value: 20 }]);
    const r = JSON.parse(await tool.execute({
      action: "chart",
      chart_type: "bar",
      data,
      title: "막대 차트 제목",
    }));
    expect(r.svg).toContain("막대 차트 제목");
    expect(r.svg).toContain("<rect");
  });
});

// ══════════════════════════════════════════
// chart — invalid data JSON
// ══════════════════════════════════════════

describe("SvgTool — chart: invalid data JSON", () => {
  it("invalid JSON data → error 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "chart", data: "not-json" }));
    expect(r.error).toContain("invalid data JSON");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("SvgTool — unknown action", () => {
  it("알 수 없는 action → error 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "nonexistent" as any }));
    expect(r.error).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// rect/circle/line — 선택적 속성 포함
// ══════════════════════════════════════════

describe("SvgTool — rect 선택적 속성", () => {
  it("rx/ry/stroke/stroke_width 포함 → 속성 출력", async () => {
    const r = JSON.parse(await tool.execute({
      action: "rect",
      x: 0, y: 0, width: 100, height: 100,
      rx: 5, ry: 5,
      stroke: "#000", stroke_width: 2,
    }));
    expect(r.svg).toContain('rx="5"');
    expect(r.svg).toContain('stroke="');
  });
});
