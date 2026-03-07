import { describe, it, expect } from "vitest";
import { SvgTool } from "../../src/agent/tools/svg.js";

function make_tool() {
  return new SvgTool({ secret_vault: undefined as never });
}

describe("SvgTool", () => {
  describe("rect", () => {
    it("사각형 SVG 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "rect", x: 10, y: 20, width: 100, height: 50 }));
      expect(r.svg).toContain("<rect");
      expect(r.svg).toContain('width="100"');
      expect(r.svg).toContain('height="50"');
    });
  });

  describe("circle", () => {
    it("원 SVG 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "circle", cx: 50, cy: 50, r: 30 }));
      expect(r.svg).toContain("<circle");
      expect(r.svg).toContain('r="30"');
    });
  });

  describe("line", () => {
    it("선 SVG 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "line", x1: 0, y1: 0, x2: 100, y2: 100 }));
      expect(r.svg).toContain("<line");
    });
  });

  describe("path", () => {
    it("경로 SVG 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "path", d: "M10 10 L90 90" }));
      expect(r.svg).toContain("<path");
      expect(r.svg).toContain("M10 10 L90 90");
    });
  });

  describe("text", () => {
    it("텍스트 SVG 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "text", content: "Hello", x: 10, y: 20 }));
      expect(r.svg).toContain("<text");
      expect(r.svg).toContain("Hello");
    });

    it("특수문자 이스케이프", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "text", content: "<script>" }));
      expect(r.svg).not.toContain("<script>");
      expect(r.svg).toContain("&lt;script&gt;");
    });
  });

  describe("viewBox", () => {
    it("SVG 래퍼 생성", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "viewBox", width: 200, height: 100, content: "<circle/>",
      }));
      expect(r.svg).toContain("xmlns=");
      expect(r.svg).toContain("viewBox=");
      expect(r.svg).toContain("<circle/>");
    });
  });

  describe("to_data_uri", () => {
    it("SVG → data URI 변환", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "to_data_uri", svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>',
      }));
      expect(r.data_uri).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(r.size).toBeGreaterThan(0);
    });

    it("빈 SVG → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "to_data_uri" }));
      expect(r.error).toContain("svg");
    });
  });

  describe("chart", () => {
    it("bar 차트 생성", async () => {
      const data = JSON.stringify([{ label: "A", value: 10 }, { label: "B", value: 20 }]);
      const r = JSON.parse(await make_tool().execute({ action: "chart", chart_type: "bar", data, title: "Test" }));
      expect(r.svg).toContain("<svg");
      expect(r.svg).toContain("<rect");
      expect(r.chart_type).toBe("bar");
      expect(r.data_points).toBe(2);
    });

    it("pie 차트 생성", async () => {
      const data = JSON.stringify([{ label: "X", value: 30 }, { label: "Y", value: 70 }]);
      const r = JSON.parse(await make_tool().execute({ action: "chart", chart_type: "pie", data }));
      expect(r.svg).toContain("<path");
    });

    it("빈 데이터 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "chart", data: "[]" }));
      expect(r.error).toContain("empty");
    });
  });
});
