/**
 * DiagramRenderTool + shell-runtime run_shell_command 커버리지.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// @vercel/beautiful-mermaid 모킹
// ══════════════════════════════════════════

vi.mock("@vercel/beautiful-mermaid", () => ({
  renderMermaid: vi.fn(),
  renderMermaidAscii: vi.fn(),
  THEMES: {
    "vercel-dark": { primaryColor: "#000", background: "#111" },
    "vercel-light": { primaryColor: "#fff", background: "#eee" },
  },
}));

import * as beautiful_mermaid from "@vercel/beautiful-mermaid";
const mock_render = beautiful_mermaid.renderMermaid as ReturnType<typeof vi.fn>;
const mock_ascii = beautiful_mermaid.renderMermaidAscii as ReturnType<typeof vi.fn>;

import { DiagramRenderTool } from "@src/agent/tools/diagram.js";

const tool = new DiagramRenderTool();

// ══════════════════════════════════════════
// DiagramRenderTool
// ══════════════════════════════════════════

describe("DiagramRenderTool — 메타데이터", () => {
  it("name = diagram_render", () => expect(tool.name).toBe("diagram_render"));
  it("category = diagram", () => expect(tool.category).toBe("diagram"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

describe("DiagramRenderTool — list_themes", () => {
  it("list_themes → themes 배열 반환", async () => {
    const r = await tool.execute({ action: "list_themes" });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed.themes)).toBe(true);
    expect(parsed.themes).toContain("vercel-dark");
    expect(parsed.themes).toContain("vercel-light");
  });
});

describe("DiagramRenderTool — SVG 렌더링", () => {
  it("render svg 성공 → SVG 반환", async () => {
    mock_render.mockResolvedValue("<svg>test</svg>");
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg" });
    expect(r).toBe("<svg>test</svg>");
  });

  it("기본 format = svg", async () => {
    mock_render.mockResolvedValue("<svg>graph</svg>");
    const r = await tool.execute({ diagram: "graph TD; A-->B" });
    expect(r).toContain("<svg>");
  });

  it("테마 지정 → render에 전달", async () => {
    mock_render.mockResolvedValue("<svg>themed</svg>");
    await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg", theme: "vercel-light" });
    expect(mock_render).toHaveBeenCalledOnce();
    const call_args = mock_render.mock.calls[0][1] as Record<string, unknown>;
    expect(call_args.primaryColor).toBe("#fff");
  });

  it("unknown 테마 → Error 반환", async () => {
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg", theme: "unknown-theme" });
    expect(r).toContain("Error");
    expect(r).toContain("unknown_theme");
  });

  it("render 예외 → Error 반환", async () => {
    mock_render.mockRejectedValue(new Error("render engine crashed"));
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg" });
    expect(r).toContain("Error");
    expect(r).toContain("render engine crashed");
  });

  it("animate=true → render_options.animate=true", async () => {
    mock_render.mockResolvedValue("<svg>animated</svg>");
    await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg", animate: true });
    const call_args = mock_render.mock.calls[0][1] as Record<string, unknown>;
    expect(call_args.animate).toBe(true);
  });

  it("max_chars 초과 → 잘림 표시", async () => {
    mock_render.mockResolvedValue("x".repeat(2000));
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", max_chars: 1000 });
    expect(r).toContain("(truncated)");
    expect(r.length).toBeLessThan(2000);
  });
});

describe("DiagramRenderTool — ASCII 렌더링", () => {
  it("render ascii 성공 → 텍스트 반환", async () => {
    mock_ascii.mockReturnValue("A --> B");
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "ascii" });
    expect(r).toBe("A --> B");
  });

  it("use_ascii=true → renderMermaidAscii에 useAscii 전달", async () => {
    mock_ascii.mockReturnValue("A-B");
    await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "ascii", use_ascii: true });
    const call_args = mock_ascii.mock.calls[0][1] as { useAscii?: boolean };
    expect(call_args.useAscii).toBe(true);
  });

  it("ascii render 예외 → Error 반환", async () => {
    mock_ascii.mockImplementation(() => { throw new Error("ascii render failed"); });
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "ascii" });
    expect(r).toContain("Error");
    expect(r).toContain("ascii render failed");
  });
});

describe("DiagramRenderTool — 유효성 검사", () => {
  it("diagram 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "render", diagram: "" });
    expect(r).toContain("Error");
    expect(r).toContain("diagram");
  });

  it("signal aborted → Error: cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B" }, { signal: controller.signal });
    expect(r).toContain("Error");
    expect(r).toContain("cancel");
  });

  it("unsupported action → Error 반환", async () => {
    const r = await tool.execute({ action: "export", diagram: "graph TD" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported action");
  });

  it("unsupported format → Error 반환", async () => {
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "png" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported format");
  });

  it("max_chars=Infinity → L7 clamp(Infinity) → min=1000 적용 → truncate", async () => {
    mock_render.mockResolvedValue("x".repeat(5000));
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", max_chars: Infinity });
    expect(r).toContain("(truncated)");
  });

  it("THEMES가 배열이면 → L19 return {} → names.length=0 → 테마 없이 렌더 (L19)", async () => {
    const original = (beautiful_mermaid as any).THEMES;
    (beautiful_mermaid as any).THEMES = []; // array → L19 fires
    mock_render.mockResolvedValue("<svg>no-theme</svg>");
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg" });
    (beautiful_mermaid as any).THEMES = original;
    expect(r).toContain("<svg>");
  });

  it("THEMES에 비객체 값 포함 → L22 continue (L22)", async () => {
    const original = (beautiful_mermaid as any).THEMES;
    (beautiful_mermaid as any).THEMES = { "bad-theme": null, "vercel-dark": { primaryColor: "#000" } };
    mock_render.mockResolvedValue("<svg>themed</svg>");
    const r = await tool.execute({ action: "render", diagram: "graph TD; A-->B", format: "svg", theme: "vercel-dark" });
    (beautiful_mermaid as any).THEMES = original;
    expect(r).toContain("<svg>");
  });
});

// ══════════════════════════════════════════
// shell-runtime — parse_just_bash_output
// ══════════════════════════════════════════

// parse_just_bash_output는 내부 함수이지만 run_shell_command를 통해 간접 테스트.
// run_shell_command는 just-bash 유무에 따라 두 경로로 분기.

// 테스트를 위해 child_process를 모킹 — 이 테스트 파일에서만 적용됨
// just-bash 관련 경로는 별도 테스트 파일에서 더 세밀하게 테스트.
// 여기서는 공개 API run_shell_command의 기본 동작 확인.

import { run_shell_command } from "@src/agent/tools/shell-runtime.js";
import type { ShellRunOptions } from "@src/agent/tools/shell-runtime.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPTS: ShellRunOptions = {
  cwd: join(tmpdir(), "shell-rt-test"),
  timeout_ms: 5000,
  max_buffer_bytes: 1024 * 1024,
};

// just-bash npx 자동 설치를 막아 시스템 셸 폴백 경로를 강제 테스트
beforeAll(() => { process.env.NO_JUST_BASH = "1"; });
afterAll(() => { delete process.env.NO_JUST_BASH; });

describe("run_shell_command — 시스템 셸 폴백 (just-bash 없음)", () => {
  it("echo 명령 실행 → stdout 반환", async () => {
    const r = await run_shell_command("echo hello", { ...OPTS, cwd: tmpdir() });
    expect(r.stdout.trim()).toContain("hello");
  });

  it("stderr 출력 → stderr 필드에 반환", async () => {
    // stderr을 직접 출력하는 명령 (플랫폼 중립)
    const r = await run_shell_command("node -e \"process.stderr.write('error_output')\"", { ...OPTS, cwd: tmpdir() });
    expect(r.stderr).toContain("error_output");
  });

  it("명령 실패 → 예외 throw", async () => {
    await expect(
      run_shell_command("node -e \"process.exit(1)\"", { ...OPTS, cwd: tmpdir() })
    ).rejects.toThrow();
  });

  it("signal aborted → 예외 throw", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      run_shell_command("echo hello", { ...OPTS, cwd: tmpdir(), signal: controller.signal })
    ).rejects.toThrow();
  });
});
