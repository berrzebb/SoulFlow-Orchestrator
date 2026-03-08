/**
 * AsciiArtTool — 배너/박스/라인/테이블/figlet/border 테스트.
 */
import { describe, it, expect } from "vitest";
import { AsciiArtTool } from "../../../src/agent/tools/ascii-art.js";

const tool = new AsciiArtTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

describe("AsciiArtTool — banner / figlet", () => {
  it("banner: 텍스트 → 5행 ASCII 아트", async () => {
    const r = await exec({ action: "banner", text: "A" });
    const lines = r.split("\n");
    expect(lines.length).toBe(5);
  });

  it("figlet: banner와 동일 동작", async () => {
    const banner = await exec({ action: "banner", text: "HI" });
    const figlet = await exec({ action: "figlet", text: "HI" });
    expect(banner).toBe(figlet);
  });

  it("알 수 없는 문자 → ? 대체 사용", async () => {
    const r = await exec({ action: "banner", text: "@" });
    expect(r.split("\n").length).toBe(5);
  });

  it("숫자 포함 텍스트", async () => {
    const r = await exec({ action: "banner", text: "123" });
    expect(r.split("\n").length).toBe(5);
  });
});

describe("AsciiArtTool — box", () => {
  it("single 스타일 박스", async () => {
    const r = await exec({ action: "box", text: "Hello" });
    const lines = r.split("\n");
    expect(lines.length).toBe(3); // top + body + bot
    expect(lines[1]).toContain("Hello");
  });

  it("double 스타일 박스", async () => {
    const r = await exec({ action: "box", text: "Test", style: "double" });
    expect(r).toContain("\u2554"); // ╔ 문자
  });

  it("round 스타일 박스", async () => {
    const r = await exec({ action: "box", text: "Test", style: "round" });
    expect(r).toContain("\u256D"); // ╭ 문자
  });

  it("heavy 스타일 박스", async () => {
    const r = await exec({ action: "box", text: "Test", style: "heavy" });
    expect(r).toContain("\u250F"); // ┏ 문자
  });

  it("멀티라인 텍스트 박스", async () => {
    const r = await exec({ action: "box", text: "Line 1\nLine 2" });
    const lines = r.split("\n");
    expect(lines.length).toBe(4); // top + 2 body lines + bot
  });
});

describe("AsciiArtTool — line", () => {
  it("기본 선 (-)으로 60자", async () => {
    const r = await exec({ action: "line" });
    expect(r.length).toBe(60);
    expect(r).toBe("-".repeat(60));
  });

  it("사용자 정의 문자와 너비", async () => {
    const r = await exec({ action: "line", char: "=", width: 30 });
    expect(r.length).toBe(30);
    expect(r).toBe("=".repeat(30));
  });
});

describe("AsciiArtTool — table", () => {
  it("기본 테이블 렌더링", async () => {
    const data = JSON.stringify([["Alice", "30"], ["Bob", "25"]]);
    const headers = JSON.stringify(["Name", "Age"]);
    const r = await exec({ action: "table", data, headers });
    expect(r).toContain("Name");
    expect(r).toContain("Age");
    expect(r).toContain("Alice");
    expect(r).toContain("30");
  });

  it("헤더 없는 테이블", async () => {
    const data = JSON.stringify([["A", "B"], ["C", "D"]]);
    const r = await exec({ action: "table", data });
    expect(r).toContain("A");
    expect(r).toContain("C");
  });

  it("잘못된 data JSON → Error", async () => {
    const r = await exec({ action: "table", data: "bad" });
    expect(r).toContain("Error");
  });
});

describe("AsciiArtTool — border", () => {
  it("기본 border (*)", async () => {
    const r = await exec({ action: "border", text: "Hello World" });
    const lines = r.split("\n");
    expect(lines[0]).toBe("*".repeat(60));
    expect(lines[lines.length - 1]).toBe("*".repeat(60));
    expect(lines[1]).toContain("Hello World");
  });

  it("사용자 정의 문자와 너비", async () => {
    const r = await exec({ action: "border", text: "Test", char: "#", width: 30 });
    const lines = r.split("\n");
    expect(lines[0]).toBe("#".repeat(30));
  });
});
