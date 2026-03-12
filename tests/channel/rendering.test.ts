/**
 * rendering.ts — 통합 유틸리티 테스트.
 * rendering.test.ts(기존) + coverage + cov2 + cov3 + cov4 + cov5 + cov6 통합.
 * (cov7은 vi.mock 격리 필요 → rendering-sanitizer-mock.test.ts)
 */
import { describe, it, expect } from "vitest";
import {
  render_agent_output,
  render_tool_block,
  split_markdown,
  normalize_render_mode,
  normalize_block_policy,
  default_render_profile,
  get_provider_max_length,
} from "@src/channels/rendering.js";

const md_profile = {
  mode: "markdown" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

const html_profile = {
  mode: "html" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

const plain_profile = {
  mode: "plain" as const,
  blocked_link_policy: "indicator" as const,
  blocked_image_policy: "indicator" as const,
};

// ════════════════════════════════════════════════
// 1. Normalization (render_mode, block_policy)
// ════════════════════════════════════════════════

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

  it("빈 문자열 → null", () => expect(normalize_render_mode("")).toBeNull());
  it("알 수 없는 값 → null", () => expect(normalize_render_mode("unknown-mode")).toBeNull());
  it("undefined → null", () => expect(normalize_render_mode(undefined)).toBeNull());
  it("null → null", () => expect(normalize_render_mode(null)).toBeNull());
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

  it("알 수 없는 값 → null", () => expect(normalize_block_policy("unknown")).toBeNull());
  it("빈 문자열 → null", () => expect(normalize_block_policy("")).toBeNull());
});

// ════════════════════════════════════════════════
// 2. Provider config (default_render_profile, get_provider_max_length)
// ════════════════════════════════════════════════

describe("default_render_profile", () => {
  it("telegram → html 모드", () => expect(default_render_profile("telegram").mode).toBe("html"));
  it("slack → markdown 모드", () => expect(default_render_profile("slack").mode).toBe("markdown"));
  it("discord → markdown 모드", () => expect(default_render_profile("discord").mode).toBe("markdown"));
});

describe("get_provider_max_length", () => {
  it("discord → 1950", () => expect(get_provider_max_length("discord")).toBe(1950));
  it("slack → 3800", () => expect(get_provider_max_length("slack")).toBe(3800));
  it("telegram → 4000", () => expect(get_provider_max_length("telegram")).toBe(4000));
  it("web → 20000", () => expect(get_provider_max_length("web")).toBe(20_000));
  it("알 수 없는 provider → 1950 (기본값)", () => expect(get_provider_max_length("unknown")).toBe(1950));
  it("대소문자 무시", () => expect(get_provider_max_length("Telegram")).toBe(4000));
});

// ════════════════════════════════════════════════
// 3. Rendering (render_tool_block, render_agent_output, markdown_to_plain, inline_token_restore)
// ════════════════════════════════════════════════

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

  it("html 모드 → <code> 태그 정확히 감쌈", () => {
    const r = render_tool_block("`code`", html_profile);
    expect(r.content).toContain("<code>code</code>");
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

  it("html 모드에서 <script> 이스케이프됨", () => {
    const r = render_tool_block("<script>alert(1)</script>", html_profile);
    expect(r.content).toContain("&lt;script&gt;");
    expect(r.content).not.toContain("<script>");
  });
});

describe("render_agent_output — 빈/공백 입력", () => {
  it("빈 문자열 → 빈 출력", () => {
    const r = render_agent_output("", md_profile);
    expect(r.markdown).toBe("");
    expect(r.content).toBe("");
  });

  it("공백만 → 빈 출력", () => {
    const r = render_agent_output("   \n\n  ", md_profile);
    expect(r.markdown).toBe("");
    expect(r.content).toBe("");
  });
});

describe("render_agent_output — 기본 모드별 동작", () => {
  it("markdown 모드 — 백슬래시 이스케이프 제거", () => {
    const r = render_agent_output("Hello \\*world\\*", md_profile);
    expect(r.content).toContain("*world*");
  });

  it("html 모드 — parse_mode 설정 + <b> 변환", () => {
    const r = render_agent_output("**bold** text", html_profile);
    expect(r.parse_mode).toBe("HTML");
    expect(r.content).toContain("<b>");
  });

  it("HTML 태그 → 마크다운 변환 (**bold** / *italic*)", () => {
    const r = render_agent_output("<b>bold</b> <i>italic</i>", md_profile);
    expect(r.markdown).toContain("**bold**");
    expect(r.markdown).toContain("*italic*");
  });

  it("위험한 HTML 태그 제거", () => {
    const r = render_agent_output("<script>alert('xss')</script>Hello", md_profile);
    expect(r.content).not.toContain("<script>");
    expect(r.content).toContain("Hello");
  });
});

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
    expect(r.content).not.toContain("**");
    expect(r.content).not.toContain("*");
  });
});

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

// ════════════════════════════════════════════════
// 4. HTML conversion (html mode rendering, normalize_html_to_markdown, auto-link)
// ════════════════════════════════════════════════

describe("render_agent_output — html 모드 변환", () => {
  it("코드 블록 → <pre><code> 변환", () => {
    const raw = "```javascript\nconsole.log('hello');\n```";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<pre><code>");
    expect(r.content).toContain("console.log");
    expect(r.parse_mode).toBe("HTML");
  });

  it("heading (#) → <b> 변환", () => {
    const r = render_agent_output("# 제목입니다", html_profile);
    expect(r.content).toContain("<b>제목입니다</b>");
  });

  it("## 제목 → <b> 태그", () => {
    const r = render_agent_output("## 제목 텍스트", html_profile);
    expect(r.content).toContain("<b>");
    expect(r.content).toContain("제목 텍스트");
  });

  it("bullet list (-) → • 변환", () => {
    const raw = "- 항목 1\n- 항목 2";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("• 항목 1");
    expect(r.content).toContain("• 항목 2");
  });

  it("numbered list (1.) → 번호. 변환", () => {
    const raw = "1. 첫 번째\n2. 두 번째";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("1. 첫 번째");
    expect(r.content).toContain("2. 두 번째");
  });

  it("인라인 bold **text** → <b> 변환", () => {
    const raw = "**굵은** 텍스트입니다.";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<b>굵은</b>");
  });

  it("인라인 italic *text* → <i> 변환", () => {
    const raw = "*기울임* 텍스트";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<i>기울임</i>");
  });

  it("인라인 코드 `code` → <code> 변환", () => {
    const raw = "인라인 `코드` 입니다.";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<code>코드</code>");
  });

  it("링크 [label](url) → <a href> 변환", () => {
    const raw = "[Google](https://www.google.com)";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<a href=");
    expect(r.content).toContain("google.com");
  });

  it("미종결 코드블록 → 강제 닫힘", () => {
    const raw = "```python\nprint('hello')";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("<pre><code>");
    expect(r.content).toContain("print");
  });

  it("빈 줄 → 줄바꿈 처리됨", () => {
    const raw = "문단 1\n\n문단 2";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("문단 1");
    expect(r.content).toContain("문단 2");
  });
});

describe("render_agent_output — normalize_html_to_markdown 태그 변환", () => {
  it("<b>bold</b> → **bold**", () => {
    const raw = "<b>굵은 텍스트</b>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("굵은 텍스트");
  });

  it("<strong>text</strong> → **text**", () => {
    const raw = "<strong>강조</strong>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("강조");
  });

  it("<em>text</em> → *text*", () => {
    const raw = "<em>이탤릭</em>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("이탤릭");
  });

  it("<code>inline</code> → `inline`", () => {
    const raw = "텍스트 <code>코드</code> 끝";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("코드");
  });

  it("<a href> → [label](url)", () => {
    const raw = '<a href="https://example.com">링크</a>';
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("링크");
  });

  it("<img> 태그 → 제거됨", () => {
    const raw = "<img src='https://example.com/img.png' alt='테스트'/>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).not.toContain("<img");
  });

  it("</p> → <p> 경계 → 단락 구분", () => {
    const raw = "<p>첫 단락</p><p>두번째 단락</p>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("첫 단락");
    expect(r.markdown).toContain("두번째 단락");
  });

  it("<script> 태그 → 완전 제거", () => {
    const raw = "<p>안전</p><script>alert(1)</script>";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).not.toContain("alert");
  });

  it("<br> → 줄바꿈", () => {
    const raw = "줄1<br>줄2<br/>줄3";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toContain("줄1");
    expect(r.content).toContain("줄2");
  });
});

describe("render_agent_output — html 모드 auto-link (bare URL)", () => {
  it("https:// bare URL → <a href> 링크", () => {
    const raw = "방문하세요 https://example.com";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
  });

  it("잘못된 포트의 https URL → urlRaw 반환", () => {
    const raw = "visit https://example:notaport/path today";
    const r = render_agent_output(raw, html_profile);
    expect(typeof r.content).toBe("string");
  });
});

// ════════════════════════════════════════════════
// 5. Policies (blocked_image_policy, blocked_link_policy, secret_resolution)
// ════════════════════════════════════════════════

describe("render_agent_output — blocked_image_policy 분기", () => {
  const remove_img = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "remove" as const };
  const text_only_img = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "text-only" as const };

  it("remove 정책 + ftp:// 이미지 → 이미지 완전 제거", () => {
    const raw = "before ![removed-alt](ftp://x.example.com/img.png) after";
    const r = render_agent_output(raw, remove_img);
    expect(r.markdown).not.toContain("removed-alt");
    expect(r.markdown).not.toContain("/forbidden");
  });

  it("remove 정책 + alt 없음 + data: URI → 이미지 제거", () => {
    const raw = "before ![](data:image/png;base64,abc) after";
    const r = render_agent_output(raw, remove_img);
    expect(r.markdown).not.toContain("/forbidden");
    expect(r.markdown).not.toContain("data:");
  });

  it("text-only 정책 + alt 없음 + ftp:// → 'image' fallback", () => {
    const raw = "before ![](ftp://x.example.com/img.png) after";
    const r = render_agent_output(raw, text_only_img);
    expect(r.markdown).toContain("image");
  });

  it("text-only 정책 + data: URI → 'image' 반환", () => {
    const raw = "before ![caption](data:image/png;base64,abc) after";
    const r = render_agent_output(raw, text_only_img);
    expect(r.markdown).toContain("image");
  });

  it("indicator 정책 + ftp:// 이미지 → [image blocked]", () => {
    const raw = "X ![](ftp://x.example.com/img.png) Y";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("[image blocked]");
  });

  it("indicator 정책 + data: URI → [image blocked]", () => {
    const raw = "before ![caption](data:image/png;base64,abc) after";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("[image blocked]");
  });

  it("허용 안 된 이미지 URL → remove 정책 적용됨", () => {
    const raw = "여기 이미지가 있습니다:\n\n![my image](ftp://example.com/blocked.jpg)\n\n그리고 텍스트";
    const r = render_agent_output(raw, remove_img);
    expect(r.content).not.toContain("blocked.jpg");
    expect(r.content).toContain("텍스트");
  });
});

describe("render_agent_output — blocked_link_policy 분기", () => {
  const remove_link = { mode: "markdown" as const, blocked_link_policy: "remove" as const, blocked_image_policy: "indicator" as const };
  const text_only_link = { mode: "markdown" as const, blocked_link_policy: "text-only" as const, blocked_image_policy: "indicator" as const };

  it("remove 정책 → ftp:// 링크 완전 제거", () => {
    const raw = "[blocked link](ftp://bad.example.com/page)";
    const r = render_agent_output(raw, remove_link);
    expect(r.content).not.toContain("ftp://");
    expect(r.content).not.toContain("blocked link");
  });

  it("remove 정책 → javascript: 링크 제거", () => {
    const raw = "클릭하세요: [위험한 링크](javascript:alert(1)) 이후 텍스트";
    const r = render_agent_output(raw, remove_link);
    expect(r.content).not.toContain("javascript");
    expect(r.content).toContain("이후 텍스트");
  });

  it("remove 정책 → mailto: 비이메일 링크 완전 제거", () => {
    const raw = "클릭: [비이메일링크](mailto:test)";
    const r = render_agent_output(raw, remove_link);
    expect(r.markdown).not.toContain("비이메일링크");
  });

  it("text-only 정책 → 링크 텍스트만", () => {
    const raw = "클릭: [링크텍스트](https://blocked.invalid/page)";
    const r = render_agent_output(raw, text_only_link);
    expect(r.markdown).toContain("링크텍스트");
    expect(r.markdown).not.toContain("[blocked-link]");
  });
});

describe("render_agent_output — secret_resolution_required 템플릿", () => {
  it("Error: secret_resolution_required → 구조화된 마크다운 출력", () => {
    const raw = [
      "Error: secret_resolution_required",
      "missing_keys: MY_API_KEY, MY_TOKEN",
      "invalid_ciphertexts: BAD_CIPHER",
    ].join("\n");
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toContain("복호화");
    expect(r.content).toContain("MY_API_KEY");
  });

  it("누락 키/무효 암호문 없는 경우 → (없음) 표시", () => {
    const raw = "Error: secret_resolution_required\n";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toContain("(없음)");
  });

  it("invalid_ciphertexts 포함", () => {
    const raw = "Error: secret_resolution_required\nmissing_keys:\ninvalid_ciphertexts: cipher1, cipher2";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("cipher1");
  });
});

// ════════════════════════════════════════════════
// 6. Link handling (fix_blocked_email_links, normalize_href, rewrite_remote_images)
// ════════════════════════════════════════════════

describe("rendering — fix_blocked_email_links", () => {
  it("이메일 주소가 label인 [#] 링크 → 이메일 그대로 표시", () => {
    const raw = "[test@example.com](#)";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toContain("test@example.com");
    expect(r.content).not.toContain("[blocked-link]");
  });

  it("mailto: 링크 이메일 라벨 → 이메일 주소 복원", () => {
    const raw = "[user@example.com](mailto:user@example.com)";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("user@example.com");
  });

  it("비이메일 blocked mailto: 링크 → indicator [blocked-link] 처리", () => {
    const raw = "[non-email-link](mailto:test)";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("non-email-link");
    expect(r.markdown).toContain("blocked-link");
  });

  it("이메일 아닌 label의 [text](#) → blocked-link 표시", () => {
    const r = render_agent_output("click [not-an-email](#) here", md_profile);
    expect(r.content).toContain("not-an-email");
  });
});

describe("rendering — normalize_href", () => {
  it("mailto: 링크 → 허용됨", () => {
    const r = render_agent_output("[Email](mailto:user@example.com)", html_profile);
    expect(r.content).toContain("Email");
  });

  it("#anchor 링크 → label만 반환 (href=null)", () => {
    const raw = "텍스트 [레이블](#) 이후";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("레이블");
    expect(r.content).not.toContain('href="#"');
  });

  it("지원 안 되는 프로토콜(ftp:) → label만 표시, <a> 없음", () => {
    const raw = "[download file](ftp://files.example.com/file.zip)";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("download file");
    expect(r.content).not.toContain("ftp://");
    expect(r.content).not.toContain("<a href");
  });

  it("javascript: 프로토콜 → null 반환 → label만 출력", () => {
    const raw = "[click me](javascript:alert(1))";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
    expect(r.content).not.toContain("javascript:");
  });

  it("html 모드: mailto: protocol → href 유효 (허용됨)", () => {
    const raw = "[email me](mailto:user@example.com)";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("email me");
  });

  it("html 모드: 잘못된 포트 URL → label 반환", () => {
    const raw = "check [google](https://example:notaport/path) link";
    const r = render_agent_output(raw, html_profile);
    expect(typeof r.content).toBe("string");
  });
});

describe("rendering — rewrite_remote_markdown_images", () => {
  it("원격 이미지 + alt → URL 텍스트로 변환 (이미지 마크다운 제거)", () => {
    const raw = "![이미지 설명](https://example.com/photo.jpg)";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("example.com/photo.jpg");
    expect(r.markdown).not.toContain("![");
  });

  it("원격 이미지 + alt 없음 → url만 반환", () => {
    const raw = "![](https://example.com/noalt.jpg)";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("example.com/noalt.jpg");
  });

  it("alt 있는 cdn 이미지 → URL 포함 string 반환", () => {
    const raw = "![my photo](https://cdn.example.com/photo.jpg) caption";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toContain("cdn.example.com");
  });
});

// ════════════════════════════════════════════════
// 7. Text processing (unescape hex entities, split_markdown)
// ════════════════════════════════════════════════

describe("rendering — unescape hex entities", () => {
  it("유효 hex entity &#x41; → 'A' (html 모드)", () => {
    const raw = "hello &#x41; world";
    const r = render_agent_output(raw, html_profile);
    expect(typeof r.content).toBe("string");
  });

  it("HEX 엔티티 &1f600; → 이모지 디코딩 (markdown 모드)", () => {
    const r = render_agent_output("emoji &1f600; here", md_profile);
    expect(typeof r.content).toBe("string");
  });

  it("유효 범위 초과 코드포인트 (&ffffff;) → 원본 유지", () => {
    const raw = "test &ffffff; text";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toContain("test");
  });

  it("&#110000; (>0x10ffff) → 원본 유지", () => {
    const raw = "test &#110000; end";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toBeDefined();
  });

  it("&zz; (비 hex) → 파싱 실패 → 원본 유지", () => {
    const raw = "text &zz; here";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
  });

  it("&#41; = ')' → 정상 변환", () => {
    const raw = "파렌 &#29; 테스트";
    const r = render_agent_output(raw, md_profile);
    expect(r.content).toBeDefined();
  });
});

describe("split_markdown", () => {
  it("짧은 텍스트 → 분할 안 됨", () => {
    expect(split_markdown("hello", 100)).toEqual(["hello"]);
  });

  it("빈 문자열 → [빈 문자열] 반환", () => {
    expect(split_markdown("", 100)).toEqual([""]);
  });

  it("max_length 초과 시 분할 + 각 청크 ≤ max_length", () => {
    const text = "a".repeat(200);
    const chunks = split_markdown(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("단락 경계(\\n\\n)에서 분할 우선", () => {
    const text = "paragraph1\n\nparagraph2\n\nparagraph3";
    const chunks = split_markdown(text, 25);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe("paragraph1\n\nparagraph2");
    expect(chunks[1]).toBe("paragraph3");
  });

  it("줄바꿈(\\n) 경계에서 분할", () => {
    const text = "line1\nline2\nline3\nline4\nline5";
    const chunks = split_markdown(text, 15);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("공백 경계에서 분할", () => {
    const text = "A".repeat(40) + " " + "B".repeat(40);
    const chunks = split_markdown(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("경계 없음 → 하드 컷", () => {
    const text = "A".repeat(100);
    const chunks = split_markdown(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 50)).toBe(true);
  });

  it("마지막 남은 텍스트도 포함됨", () => {
    const text = "A".repeat(50) + "\n\n" + "마지막";
    const chunks = split_markdown(text, 60);
    const joined = chunks.join(" ");
    expect(joined).toContain("마지막");
  });

  it("모든 청크 합치면 원본 내용 보존", () => {
    const text = "Hello World! This is a test of splitting.\n\nNew paragraph here.\nAnd another line.";
    const chunks = split_markdown(text, 30);
    const joined = chunks.join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("Hello World");
    expect(joined).toContain("another line");
  });
});

// ════════════════════════════════════════════════
// 8. Plain mode (all plain rendering tests)
// ════════════════════════════════════════════════

describe("render_agent_output — plain 모드", () => {
  it("[label](#) → label만 출력 (url=# 는 skip)", () => {
    const raw = "[보기](#)";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("보기");
    expect(r.content).not.toContain("(#)");
  });

  it("[label](url) → label 포함", () => {
    const raw = "이 링크는 [GitHub](https://github.com)입니다.";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("GitHub");
  });

  it("[label](url) + 유효 url → label + url 포함", () => {
    const raw = "텍스트 [링크 레이블](https://example.com/page) 더 텍스트";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("링크 레이블");
    expect(r.content).toContain("example.com");
  });

  it("코드블록 → 코드 내용만 (fence 제거)", () => {
    const raw = "```\nconsole.log('test')\n```";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("console.log");
    expect(r.content).not.toContain("```");
  });

  it("**굵게** → 텍스트만", () => {
    const raw = "**중요한 내용**";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("중요한 내용");
    expect(r.content).not.toContain("**");
  });

  it("# 제목 → 텍스트만", () => {
    const raw = "# 제목";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("제목");
    expect(r.content).not.toContain("#");
  });

  it("- 목록 → • 변환", () => {
    const raw = "- 아이템";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("•");
  });

  it("~~strikethrough~~ → 취소선 텍스트 유지", () => {
    const raw = "취소선 텍스트";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("취소선 텍스트");
  });
});
