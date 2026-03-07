import { describe, it, expect } from "vitest";
import {
  normalize_render_mode,
  normalize_block_policy,
  render_agent_output,
  render_tool_block,
  get_provider_max_length,
  split_markdown,
  default_render_profile,
} from "@src/channels/rendering.js";

describe("normalize_render_mode", () => {
  it("markdown 변형 인식", () => {
    expect(normalize_render_mode("markdown")).toBe("markdown");
    expect(normalize_render_mode("md")).toBe("markdown");
    expect(normalize_render_mode("마크다운")).toBe("markdown");
  });

  it("html 인식", () => {
    expect(normalize_render_mode("html")).toBe("html");
  });

  it("plain 변형 인식", () => {
    expect(normalize_render_mode("plain")).toBe("plain");
    expect(normalize_render_mode("text")).toBe("plain");
    expect(normalize_render_mode("txt")).toBe("plain");
    expect(normalize_render_mode("텍스트")).toBe("plain");
  });

  it("대소문자 무시", () => {
    expect(normalize_render_mode("MARKDOWN")).toBe("markdown");
    expect(normalize_render_mode("HTML")).toBe("html");
  });

  it("빈/미인식 값 → null", () => {
    expect(normalize_render_mode("")).toBeNull();
    expect(normalize_render_mode("unknown")).toBeNull();
    expect(normalize_render_mode(null)).toBeNull();
  });
});

describe("normalize_block_policy", () => {
  it("indicator 변형", () => {
    expect(normalize_block_policy("indicator")).toBe("indicator");
    expect(normalize_block_policy("표시")).toBe("indicator");
  });

  it("text-only 변형", () => {
    expect(normalize_block_policy("text-only")).toBe("text-only");
    expect(normalize_block_policy("text_only")).toBe("text-only");
    expect(normalize_block_policy("text")).toBe("text-only");
    expect(normalize_block_policy("텍스트")).toBe("text-only");
  });

  it("remove 변형", () => {
    expect(normalize_block_policy("remove")).toBe("remove");
    expect(normalize_block_policy("삭제")).toBe("remove");
    expect(normalize_block_policy("none")).toBe("remove");
  });

  it("빈/미인식 → null", () => {
    expect(normalize_block_policy("")).toBeNull();
    expect(normalize_block_policy("unknown")).toBeNull();
  });
});

describe("default_render_profile", () => {
  it("telegram → html", () => {
    expect(default_render_profile("telegram").mode).toBe("html");
  });

  it("slack → markdown", () => {
    expect(default_render_profile("slack").mode).toBe("markdown");
  });

  it("discord → markdown", () => {
    expect(default_render_profile("discord").mode).toBe("markdown");
  });
});

describe("get_provider_max_length", () => {
  it("discord → 1950", () => {
    expect(get_provider_max_length("discord")).toBe(1950);
  });

  it("slack → 3800", () => {
    expect(get_provider_max_length("slack")).toBe(3800);
  });

  it("telegram → 4000", () => {
    expect(get_provider_max_length("telegram")).toBe(4000);
  });

  it("web → 20000", () => {
    expect(get_provider_max_length("web")).toBe(20000);
  });

  it("알 수 없는 provider → 기본값 1950", () => {
    expect(get_provider_max_length("unknown")).toBe(1950);
  });

  it("대소문자 무시", () => {
    expect(get_provider_max_length("Telegram")).toBe(4000);
  });
});

describe("split_markdown", () => {
  it("짧은 텍스트 → 분할 없음", () => {
    expect(split_markdown("hello", 100)).toEqual(["hello"]);
  });

  it("빈 텍스트 → 그대로", () => {
    expect(split_markdown("", 100)).toEqual([""]);
  });

  it("max_length 초과 시 분할", () => {
    const text = "a".repeat(200);
    const chunks = split_markdown(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("단락 경계에서 분할 우선", () => {
    // max_length 내 마지막 \n\n에서 분할
    const text = "paragraph1\n\nparagraph2\n\nparagraph3";
    const chunks = split_markdown(text, 25);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 위치 22의 \n\n에서 분할 → 첫 청크에 paragraph1+paragraph2 포함
    expect(chunks[0]).toBe("paragraph1\n\nparagraph2");
    expect(chunks[1]).toBe("paragraph3");
  });

  it("줄바꿈에서 분할", () => {
    const text = "line1\nline2\nline3\nline4\nline5";
    const chunks = split_markdown(text, 15);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("모든 청크 합치면 원본 보존", () => {
    const text = "Hello World! This is a test of splitting.\n\nNew paragraph here.\nAnd another line.";
    const chunks = split_markdown(text, 30);
    const joined = chunks.join(" ");
    // 내용은 보존되어야 함 (공백 차이 허용)
    expect(joined.replace(/\s+/g, " ")).toContain("Hello World");
    expect(joined.replace(/\s+/g, " ")).toContain("another line");
  });
});

describe("render_agent_output", () => {
  const md_profile = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
  const html_profile = { mode: "html" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
  const plain_profile = { mode: "plain" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };

  it("빈 입력 → 빈 결과", () => {
    const result = render_agent_output("", md_profile);
    expect(result.content).toBe("");
  });

  it("markdown 모드 — 백슬래시 이스케이프 제거", () => {
    const result = render_agent_output("Hello \\*world\\*", md_profile);
    expect(result.content).toContain("*world*");
  });

  it("html 모드 — parse_mode 설정", () => {
    const result = render_agent_output("**bold** text", html_profile);
    expect(result.parse_mode).toBe("HTML");
    expect(result.content).toContain("<b>");
  });

  it("plain 모드 — 마크다운 제거", () => {
    const result = render_agent_output("**bold** and *italic*", plain_profile);
    expect(result.content).not.toContain("**");
    expect(result.content).not.toContain("*");
    expect(result.content).toContain("bold");
    expect(result.content).toContain("italic");
  });

  it("HTML 태그 → 마크다운 변환", () => {
    const result = render_agent_output("<b>bold</b> <i>italic</i>", md_profile);
    expect(result.markdown).toContain("**bold**");
    expect(result.markdown).toContain("*italic*");
  });

  it("위험한 HTML 태그 제거", () => {
    const result = render_agent_output("<script>alert('xss')</script>Hello", md_profile);
    expect(result.content).not.toContain("<script>");
    expect(result.content).toContain("Hello");
  });
});

describe("render_tool_block", () => {
  it("markdown 모드 — 그대로 전달", () => {
    const profile = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
    const result = render_tool_block("`code`", profile);
    expect(result.content).toBe("`code`");
  });

  it("plain 모드 — 백틱 제거", () => {
    const profile = { mode: "plain" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
    const result = render_tool_block("`code`", profile);
    expect(result.content).toBe("code");
  });

  it("html 모드 — code 태그 변환", () => {
    const profile = { mode: "html" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
    const result = render_tool_block("`code`", profile);
    expect(result.content).toContain("<code>code</code>");
    expect(result.parse_mode).toBe("HTML");
  });

  it("빈 입력 → 빈 결과", () => {
    const profile = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
    const result = render_tool_block("", profile);
    expect(result.content).toBe("");
  });
});
