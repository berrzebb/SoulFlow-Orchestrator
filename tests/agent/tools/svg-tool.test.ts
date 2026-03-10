/**
 * SvgTool — rect/circle/line/path/text/group/viewBox/to_data_uri/chart 커버리지.
 */
import { describe, it, expect } from "vitest";
import { SvgTool } from "../../../src/agent/tools/svg.js";

const tool = new SvgTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(r); } catch { return r; }
}

describe("SvgTool — rect", () => {
  it("기본값으로 rect 생성", async () => {
    const r = await exec({ action: "rect" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<rect");
    expect(String(r.svg)).toContain("width=\"100\"");
  });

  it("커스텀 속성 rect", async () => {
    const r = await exec({ action: "rect", x: 10, y: 20, width: 50, height: 30, fill: "red", stroke: "blue", stroke_width: 2, rx: 5 }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("fill=\"red\"");
    expect(String(r.svg)).toContain("rx=\"5\"");
  });
});

describe("SvgTool — circle", () => {
  it("기본값으로 circle 생성", async () => {
    const r = await exec({ action: "circle" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<circle");
    expect(String(r.svg)).toContain("r=\"40\"");
  });

  it("커스텀 circle", async () => {
    const r = await exec({ action: "circle", cx: 100, cy: 100, r: 50, fill: "#ff0", stroke: "#000", stroke_width: 3 }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("cx=\"100\"");
  });
});

describe("SvgTool — line", () => {
  it("기본값으로 line 생성", async () => {
    const r = await exec({ action: "line" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<line");
    expect(String(r.svg)).toContain("x1=\"0\"");
  });

  it("커스텀 line", async () => {
    const r = await exec({ action: "line", x1: 10, y1: 10, x2: 200, y2: 200, stroke: "#f00", stroke_width: 5 }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("stroke=\"#f00\"");
  });
});

describe("SvgTool — path", () => {
  it("기본값으로 path 생성", async () => {
    const r = await exec({ action: "path" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<path");
    expect(String(r.svg)).toContain("M0,0 L100,100");
  });

  it("커스텀 path", async () => {
    const r = await exec({ action: "path", d: "M10,10 L90,90", fill: "blue", stroke: "red", stroke_width: 1 }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("M10,10");
  });
});

describe("SvgTool — text", () => {
  it("기본값으로 text 생성", async () => {
    const r = await exec({ action: "text", content: "Hello" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<text");
    expect(String(r.svg)).toContain("Hello");
  });

  it("특수문자 이스케이프", async () => {
    const r = await exec({ action: "text", content: "<>&\"" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("&lt;");
    expect(String(r.svg)).toContain("&amp;");
  });

  it("커스텀 text", async () => {
    const r = await exec({ action: "text", x: 50, y: 50, fill: "#fff", font_size: 20, content: "Test" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("font-size=\"20\"");
  });
});

describe("SvgTool — group", () => {
  it("children 배열로 group 생성", async () => {
    const children = JSON.stringify(["<rect/>", "<circle/>"]);
    const r = await exec({ action: "group", children }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<g>");
    expect(String(r.svg)).toContain("<rect/>");
  });

  it("잘못된 children JSON → 빈 group", async () => {
    const r = await exec({ action: "group", children: "{bad" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<g>");
  });
});

describe("SvgTool — viewBox", () => {
  it("기본값 viewBox", async () => {
    const r = await exec({ action: "viewBox" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<svg");
    expect(String(r.svg)).toContain("viewBox");
  });

  it("커스텀 view_box + content", async () => {
    const r = await exec({ action: "viewBox", view_box: "0 0 200 150", width: 200, height: 150, content: "<rect/>" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("0 0 200 150");
    expect(String(r.svg)).toContain("<rect/>");
  });
});

describe("SvgTool — to_data_uri", () => {
  it("SVG → base64 data URI 변환", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const r = await exec({ action: "to_data_uri", svg }) as Record<string, unknown>;
    expect(String(r.data_uri)).toContain("data:image/svg+xml;base64,");
    expect(r.size).toBe(svg.length);
  });

  it("svg 없음 → error", async () => {
    const r = await exec({ action: "to_data_uri" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
    expect(r.error).toContain("required");
  });
});

describe("SvgTool — chart bar", () => {
  const data = JSON.stringify([{ label: "A", value: 10 }, { label: "B", value: 20 }]);

  it("bar 차트 생성", async () => {
    const r = await exec({ action: "chart", chart_type: "bar", data }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<rect");
    expect(r.chart_type).toBe("bar");
    expect(r.data_points).toBe(2);
  });

  it("bar 차트 + title", async () => {
    const r = await exec({ action: "chart", chart_type: "bar", data, title: "My Chart" }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("My Chart");
  });
});

describe("SvgTool — chart line", () => {
  const data = JSON.stringify([{ label: "Jan", value: 5 }, { label: "Feb", value: 15 }, { label: "Mar", value: 10 }]);

  it("line 차트 생성", async () => {
    const r = await exec({ action: "chart", chart_type: "line", data }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<polyline");
    expect(r.chart_type).toBe("line");
  });
});

describe("SvgTool — chart pie", () => {
  const data = JSON.stringify([{ label: "X", value: 30 }, { label: "Y", value: 70 }]);

  it("pie 차트 생성", async () => {
    const r = await exec({ action: "chart", chart_type: "pie", data }) as Record<string, unknown>;
    expect(String(r.svg)).toContain("<path");
    expect(r.chart_type).toBe("pie");
  });
});

describe("SvgTool — chart 오류", () => {
  it("잘못된 data JSON → error", async () => {
    const r = await exec({ action: "chart", chart_type: "bar", data: "{bad" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid data JSON");
  });

  it("빈 데이터 → error", async () => {
    const r = await exec({ action: "chart", chart_type: "bar", data: "[]" }) as Record<string, unknown>;
    expect(r.error).toContain("data is empty");
  });
});

describe("SvgTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_op" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });
});
