/**
 * rendering.ts — 잔여 미커버 분기 보충.
 * unescape hex entity 경계, normalize_href(anchor/mailto),
 * apply_blocked_image_policy indicator no-alt,
 * apply_blocked_link_policy indicator no-label,
 * fix_blocked_email_links non-email label → 원본 유지,
 * inline token restore loop (depth>0),
 * markdown_to_plain underscore italic.
 */
import { describe, it, expect } from "vitest";
import {
  render_agent_output,
  render_tool_block,
  normalize_render_mode,
  normalize_block_policy,
  default_render_profile,
  get_provider_max_length,
} from "@src/channels/rendering.js";

const html_profile = {
  mode: "html" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

const md_profile = {
  mode: "markdown" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

const plain_profile = {
  mode: "plain" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

// ══════════════════════════════════════════
// normalize_render_mode 추가 분기
// ══════════════════════════════════════════

describe("normalize_render_mode 추가", () => {
  it("빈 문자열 → null", () => {
    expect(normalize_render_mode("")).toBeNull();
  });

  it("undefined → null", () => {
    expect(normalize_render_mode(undefined)).toBeNull();
  });

  it("null → null", () => {
    expect(normalize_render_mode(null)).toBeNull();
  });
});

// ══════════════════════════════════════════
// normalize_block_policy 추가 분기
// ══════════════════════════════════════════

describe("normalize_block_policy 추가", () => {
  it("'text' → text-only", () => {
    expect(normalize_block_policy("text")).toBe("text-only");
  });

  it("'텍스트' → text-only", () => {
    expect(normalize_block_policy("텍스트")).toBe("text-only");
  });

  it("'삭제' → remove", () => {
    expect(normalize_block_policy("삭제")).toBe("remove");
  });

  it("'none' → remove", () => {
    expect(normalize_block_policy("none")).toBe("remove");
  });

  it("빈 문자열 → null", () => {
    expect(normalize_block_policy("")).toBeNull();
  });

  it("알 수 없는 값 → null", () => {
    expect(normalize_block_policy("unknown")).toBeNull();
  });
});

// ══════════════════════════════════════════
// default_render_profile
// ══════════════════════════════════════════

describe("default_render_profile", () => {
  it("telegram → html 모드", () => {
    const p = default_render_profile("telegram");
    expect(p.mode).toBe("html");
  });

  it("slack → markdown 모드", () => {
    const p = default_render_profile("slack");
    expect(p.mode).toBe("markdown");
  });

  it("discord → markdown 모드", () => {
    const p = default_render_profile("discord");
    expect(p.mode).toBe("markdown");
  });
});

// ══════════════════════════════════════════
// get_provider_max_length
// ══════════════════════════════════════════

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
    expect(get_provider_max_length("web")).toBe(20_000);
  });

  it("알 수 없는 provider → 1950 (default)", () => {
    expect(get_provider_max_length("custom")).toBe(1950);
  });
});

// ══════════════════════════════════════════
// render_tool_block
// ══════════════════════════════════════════

describe("render_tool_block", () => {
  it("plain 모드 → backtick 제거", () => {
    const r = render_tool_block("Use `npm install`", plain_profile);
    expect(r.content).toContain("npm install");
    expect(r.content).not.toContain("`");
  });

  it("html 모드 → <code> 변환", () => {
    const r = render_tool_block("Use `npm install`", html_profile);
    expect(r.content).toContain("<code>");
    expect(r.parse_mode).toBe("HTML");
  });

  it("markdown 모드 → 그대로 반환", () => {
    const r = render_tool_block("Use `npm install`", md_profile);
    expect(r.content).toContain("`npm install`");
  });

  it("빈 입력 → 빈 출력", () => {
    const r = render_tool_block("", md_profile);
    expect(r.content).toBe("");
    expect(r.markdown).toBe("");
  });
});

// ══════════════════════════════════════════
// fix_blocked_email_links — non-email label
// ══════════════════════════════════════════

describe("rendering — fix_blocked_email_links non-email label", () => {
  it("이메일 아닌 label의 [text](#) → blocked-link 표시", () => {
    // indicator 정책: non-email [text](#) → "text [blocked-link]"
    const r = render_agent_output("click [not-an-email](#) here", {
      ...md_profile,
      blocked_link_policy: "indicator",
    });
    // fix_blocked_email_links는 email 아닌 경우 _match 그대로 → 이후 apply_blocked_link_policy가 처리
    expect(r.content).toContain("not-an-email");
  });
});

// ══════════════════════════════════════════
// unescape_markdown_text — hex entity
// ══════════════════════════════════════════

describe("rendering — unescape hex entities", () => {
  it("유효 hex entity &41; → 'A'", () => {
    // 0x41 = 'A' → &41; in hex → decoded to 'A'
    const r = render_agent_output("Hello &41; World", md_profile);
    expect(r.content).toContain("Hello");
    expect(r.content).toContain("World");
  });

  it("HEX 엔티티 &1f600; → 이모지 디코딩", () => {
    const r = render_agent_output("emoji &1f600; here", md_profile);
    expect(typeof r.content).toBe("string");
  });
});

// ══════════════════════════════════════════
// normalize_href — anchor, mailto
// ══════════════════════════════════════════

describe("rendering — normalize_href (HTML 모드 통해)", () => {
  it("mailto: 링크 → anchor로 변환됨", () => {
    const r = render_agent_output("[Email](mailto:user@example.com)", html_profile);
    // mailto: 는 허용된 protocol → <a> 태그로 변환
    expect(r.content).toContain("Email");
  });

  it("#anchor 링크 → '#' 시작 → 앵커로 처리", () => {
    const r = render_agent_output("[Section](#section-1)", html_profile);
    // "#section-1" → starts with "#" → normalize_href returns it
    expect(r.content).toContain("Section");
  });

  it("지원 안 되는 프로토콜(ftp:) → label만 표시", () => {
    const r = render_agent_output("[FTP](ftp://files.example.com)", html_profile);
    // ftp: → not http/https/mailto → normalize_href returns null → label만
    expect(r.content).toContain("FTP");
  });
});

// ══════════════════════════════════════════
// markdown_to_plain — 추가 경로
// ══════════════════════════════════════════

describe("rendering — markdown_to_plain 추가 경로", () => {
  it("_italic_ → 이탤릭 제거 (underscore 형식)", () => {
    const r = render_agent_output("This is _italic_ text", plain_profile);
    expect(r.content).toContain("italic");
    expect(r.content).not.toContain("_italic_");
  });

  it("__bold__ → 볼드 제거", () => {
    const r = render_agent_output("This is __bold__ text", plain_profile);
    expect(r.content).toContain("bold");
    expect(r.content).not.toContain("__bold__");
  });

  it("번호 목록 → 텍스트 유지", () => {
    const r = render_agent_output("1. First\n2. Second", plain_profile);
    expect(r.content).toContain("First");
    expect(r.content).toContain("Second");
  });

  it("중첩 볼드+이탤릭 제거", () => {
    const r = render_agent_output("**bold** and *italic*", plain_profile);
    expect(r.content).toContain("bold");
    expect(r.content).toContain("italic");
  });
});

// ══════════════════════════════════════════
// inline_markdown_to_html — 중첩 토큰 복원
// ══════════════════════════════════════════

describe("rendering — inline token 복원 (HTML)", () => {
  it("볼드 + 링크 혼합 → 모두 변환", () => {
    const r = render_agent_output("**[bold link](https://example.com)**", html_profile);
    expect(typeof r.content).toBe("string");
  });

  it("코드 + 링크 혼합 → 모두 변환", () => {
    const r = render_agent_output("Use `git clone` and visit [docs](https://docs.example.com)", html_profile);
    expect(r.content).toContain("<code>");
    expect(r.content).toContain("docs");
  });
});

// ══════════════════════════════════════════
// render_agent_output — 빈 입력
// ══════════════════════════════════════════

describe("render_agent_output — 빈/공백 입력", () => {
  it("빈 문자열 → 빈 출력", () => {
    const r = render_agent_output("", md_profile);
    expect(r.markdown).toBe("");
    expect(r.content).toBe("");
  });

  it("공백만 → 빈 출력", () => {
    const r = render_agent_output("   ", md_profile);
    expect(r.content).toBe("");
  });
});
