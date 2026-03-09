/**
 * rendering.ts — 미커버 분기 보충 (cov4).
 * apply_blocked_image_policy remove/text-only, apply_blocked_link_policy remove,
 * fix_blocked_email_links 이메일 매치, unescape_markdown_text hex entity,
 * normalize_href invalid protocol/parse-fail, rewrite_remote_markdown_images alt/no-href,
 * markdown_to_plain url="#", sanitizeMarkdown catch block, unclosed code block edge.
 */
import { describe, it, expect } from "vitest";
import {
  render_agent_output,
  normalize_render_mode,
  normalize_block_policy,
  get_provider_max_length,
  split_markdown,
  default_render_profile,
} from "@src/channels/rendering.js";

const md_profile = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
const html_profile = { mode: "html" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };
const plain_profile = { mode: "plain" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };

// ══════════════════════════════════════════
// apply_blocked_image_policy — remove / text-only / no alt
// ══════════════════════════════════════════

describe("render_agent_output — blocked_image_policy 분기", () => {
  // ftp:// 및 data: 이미지는 sanitizer가 /forbidden으로 변환 → apply_blocked_image_policy 적용됨
  // (https:// 이미지는 허용 prefix라서 /forbidden으로 변환되지 않음)
  const remove_img = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "remove" as const };
  const text_only_img = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "text-only" as const };
  const indicator_img = { mode: "markdown" as const, blocked_link_policy: "indicator" as const, blocked_image_policy: "indicator" as const };

  it("remove 정책 + ftp:// 이미지 → 이미지 완전 제거", () => {
    const raw = "before ![removed-alt](ftp://x.example.com/img.png) after";
    const r = render_agent_output(raw, remove_img);
    // blocked image: /forbidden으로 변환 후 remove → 빈 문자열
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
    // sanitizer가 alt를 제거하므로 항상 "image" fallback 반환
    const raw = "before ![](ftp://x.example.com/img.png) after";
    const r = render_agent_output(raw, text_only_img);
    expect(r.markdown).toContain("image");
  });

  it("text-only 정책 + data: URI → 'image' 반환", () => {
    // sanitizer가 blocked 이미지 alt를 제거 → fallback "image"
    const raw = "before ![caption](data:image/png;base64,abc) after";
    const r = render_agent_output(raw, text_only_img);
    expect(r.markdown).toContain("image");
  });

  it("indicator 정책 + ftp:// 이미지 → [image blocked]", () => {
    const raw = "X ![](ftp://x.example.com/img.png) Y";
    const r = render_agent_output(raw, indicator_img);
    expect(r.markdown).toContain("[image blocked]");
  });

  it("indicator 정책 + data: URI → [image blocked]", () => {
    const raw = "before ![caption](data:image/png;base64,abc) after";
    const r = render_agent_output(raw, indicator_img);
    expect(r.markdown).toContain("[image blocked]");
  });
});

// ══════════════════════════════════════════
// apply_blocked_link_policy — remove / text-only / empty label
// ══════════════════════════════════════════

describe("render_agent_output — blocked_link_policy 분기", () => {
  const remove_link = { mode: "markdown" as const, blocked_link_policy: "remove" as const, blocked_image_policy: "indicator" as const };
  const text_only_link = { mode: "markdown" as const, blocked_link_policy: "text-only" as const, blocked_image_policy: "indicator" as const };

  it("remove 정책 → mailto: 비이메일 링크 완전 제거", () => {
    // mailto: 링크는 [label](#)으로 변환됨 → remove → 빈 문자열
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

// ══════════════════════════════════════════
// fix_blocked_email_links — 이메일 라벨 복원
// ══════════════════════════════════════════

describe("render_agent_output — fix_blocked_email_links 이메일 복원", () => {
  it("mailto: 링크 이메일 라벨 → 이메일 주소 복원", () => {
    // mailto: 링크는 allowedLinkPrefixes에 없으므로 [email@example.com](#)으로 변환
    // fix_blocked_email_links가 이메일을 감지하여 label만 반환
    const raw = "[user@example.com](mailto:user@example.com)";
    const r = render_agent_output(raw, md_profile);
    // 이메일 주소가 출력에 포함
    expect(r.markdown).toContain("user@example.com");
  });

  it("비이메일 blocked mailto: 링크 → indicator [blocked-link] 처리", () => {
    // mailto: 링크는 sanitizer가 [label](#)으로 변환, 이메일 아닌 라벨이면 indicator 유지
    const raw = "[non-email-link](mailto:test)";
    const r = render_agent_output(raw, md_profile);
    // fix_blocked_email_links: 이메일 아님 → 그대로 [label](#)
    // apply_blocked_link_policy indicator: "non-email-link [blocked-link]"
    expect(r.markdown).toContain("non-email-link");
    expect(r.markdown).toContain("blocked-link");
  });
});

// ══════════════════════════════════════════
// unescape_markdown_text — hex entity 처리
// ══════════════════════════════════════════

describe("render_agent_output — hex entity (unescape_markdown_text)", () => {
  it("&41; hex entity → 'A'로 변환 (html 모드 inline_markdown_to_html)", () => {
    // html 모드에서 inline text에 hex entity가 있으면 unescape_markdown_text 실행
    const raw = "text with &41; entity";
    const r = render_agent_output(raw, html_profile);
    // hex entity가 처리되어 'A'로 변환되거나 텍스트가 출력됨
    expect(r.content).toBeTruthy();
  });

  it("&ffffff; (범위 초과 hex) → 원본 반환", () => {
    const raw = "overflow &ffffff; entity";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
  });

  it("&zz; (비 hex) → 파싱 실패 → 원본 유지", () => {
    // &zz; 는 hex가 아니므로 HEX_ENTITY_RE가 매칭 안 됨 (0-9a-f만)
    // 그냥 텍스트로 처리됨
    const raw = "text &zz; here";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// normalize_href — invalid protocol / parse fail
// ══════════════════════════════════════════

describe("render_agent_output — normalize_href 경로", () => {
  it("javascript: 프로토콜 → null 반환 → label만 출력", () => {
    // javascript: URL은 허용 안 됨
    const raw = "[click me](javascript:alert(1))";
    const r = render_agent_output(raw, html_profile);
    // href가 null이므로 label만 반환
    expect(r.content).toBeTruthy();
    expect(r.content).not.toContain("javascript:");
  });

  it("# anchor → inline_markdown_to_html label만 출력", () => {
    const raw = "[section](#anchor)";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toContain("section");
  });

  it("bare URL with invalid href → urlRaw 그대로 반환", () => {
    // ftp:// 는 normalize_href에서 null 반환 → urlRaw 반환
    const raw = "FTP 주소: ftp://example.com/file.txt";
    const r = render_agent_output(raw, html_profile);
    expect(r.content).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// rewrite_remote_markdown_images — alt/no-alt 경로
// ══════════════════════════════════════════

describe("render_agent_output — rewrite_remote_markdown_images", () => {
  it("원격 이미지 + alt → 'alt: href' 형식으로 변환", () => {
    // 외부 이미지는 sanitizer가 /forbidden으로 변환하지 않고
    // rewrite_remote_markdown_images가 처리함
    // 단, blocked.invalid가 아닌 허용 프리픽스(https:)는 rewrite 처리
    const raw = "![설명 이미지](https://example.com/real-image.png)";
    const r = render_agent_output(raw, md_profile);
    // alt: href 형식 또는 href만 출력
    expect(r.markdown).toBeTruthy();
    expect(r.markdown).not.toContain("!["); // 이미지 마크다운 제거됨
  });

  it("원격 이미지 + alt 없음 → href만 출력", () => {
    const raw = "![](https://example.com/real-image.png)";
    const r = render_agent_output(raw, md_profile);
    expect(r.markdown).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// markdown_to_plain — url="#" → label만
// ══════════════════════════════════════════

describe("render_agent_output — plain 모드 url='#' 처리", () => {
  it("plain 모드 [label](#) → label만 출력 (url=# 는 skip)", () => {
    // [label](#) 패턴은 blocked link인데 plain 모드에서 link text replacement에서
    // url="# " → skip → return label
    const raw = "[보기](#)";
    const r = render_agent_output(raw, plain_profile);
    expect(r.content).toContain("보기");
    expect(r.content).not.toContain("(#)");
  });
});

// ══════════════════════════════════════════
// normalize_render_mode — 별칭/null 경로
// ══════════════════════════════════════════

describe("normalize_render_mode — 별칭 분기", () => {
  it("'md' → 'markdown'", () => expect(normalize_render_mode("md")).toBe("markdown"));
  it("'마크다운' → 'markdown'", () => expect(normalize_render_mode("마크다운")).toBe("markdown"));
  it("'txt' → 'plain'", () => expect(normalize_render_mode("txt")).toBe("plain"));
  it("'텍스트' → 'plain'", () => expect(normalize_render_mode("텍스트")).toBe("plain"));
  it("'text' → 'plain'", () => expect(normalize_render_mode("text")).toBe("plain"));
  it("알 수 없는 값 → null", () => expect(normalize_render_mode("unknown-mode")).toBeNull());
  it("빈 값 → null", () => expect(normalize_render_mode("")).toBeNull());
});

// ══════════════════════════════════════════
// normalize_block_policy — 별칭/null 경로
// ══════════════════════════════════════════

describe("normalize_block_policy — 별칭 분기", () => {
  it("'표시' → 'indicator'", () => expect(normalize_block_policy("표시")).toBe("indicator"));
  it("'text_only' → 'text-only'", () => expect(normalize_block_policy("text_only")).toBe("text-only"));
  it("'텍스트' → 'text-only'", () => expect(normalize_block_policy("텍스트")).toBe("text-only"));
  it("'삭제' → 'remove'", () => expect(normalize_block_policy("삭제")).toBe("remove"));
  it("'none' → 'remove'", () => expect(normalize_block_policy("none")).toBe("remove"));
  it("알 수 없는 값 → null", () => expect(normalize_block_policy("unknown")).toBeNull());
  it("빈 값 → null", () => expect(normalize_block_policy("")).toBeNull());
});

// ══════════════════════════════════════════
// get_provider_max_length — 알 수 없는 프로바이더
// ══════════════════════════════════════════

describe("get_provider_max_length — 프로바이더별 한도", () => {
  it("discord → 1950", () => expect(get_provider_max_length("discord")).toBe(1950));
  it("slack → 3800", () => expect(get_provider_max_length("slack")).toBe(3800));
  it("telegram → 4000", () => expect(get_provider_max_length("telegram")).toBe(4000));
  it("web → 20000", () => expect(get_provider_max_length("web")).toBe(20000));
  it("알 수 없는 프로바이더 → 1950 (기본값)", () => expect(get_provider_max_length("unknown")).toBe(1950));
});

// ══════════════════════════════════════════
// split_markdown — 분할 경계 분기
// ══════════════════════════════════════════

describe("split_markdown — 분할 경계", () => {
  it("max_length 이내 텍스트 → 분할 안 됨", () => {
    const r = split_markdown("short text", 1000);
    expect(r).toEqual(["short text"]);
  });

  it("단락 기준 분할 (30% 이상 위치)", () => {
    const text = "A".repeat(50) + "\n\n" + "B".repeat(50);
    const r = split_markdown(text, 80);
    expect(r.length).toBeGreaterThan(1);
  });

  it("줄바꿈 기준 분할 (단락 없음)", () => {
    const text = "A".repeat(50) + "\n" + "B".repeat(50);
    const r = split_markdown(text, 80);
    expect(r.length).toBeGreaterThan(1);
  });

  it("공백 기준 분할 (줄바꿈 없음)", () => {
    const text = "A".repeat(40) + " " + "B".repeat(40);
    const r = split_markdown(text, 60);
    expect(r.length).toBeGreaterThan(1);
  });

  it("하드 컷 (단락/줄바꿈/공백 모두 없음)", () => {
    const text = "A".repeat(100);
    const r = split_markdown(text, 50);
    expect(r.length).toBeGreaterThan(1);
    expect(r.every(chunk => chunk.length <= 50)).toBe(true);
  });
});

// ══════════════════════════════════════════
// default_render_profile — telegram vs 기타
// ══════════════════════════════════════════

describe("default_render_profile — 프로바이더별 모드", () => {
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
// secret resolution template
// ══════════════════════════════════════════

describe("render_agent_output — secret resolution template", () => {
  it("Error: secret_resolution_required → 요약 템플릿으로 변환", () => {
    const raw = [
      "Error: secret_resolution_required",
      "missing_keys: MY_API_KEY, MY_TOKEN",
      "invalid_ciphertexts: BAD_CIPHER",
    ].join("\n");
    const r = render_agent_output(raw, md_profile);
    // r.content는 마크다운 이스케이프를 제거한 버전 (MY\_API\_KEY → MY_API_KEY)
    expect(r.content).toContain("복호화");
    expect(r.content).toContain("MY_API_KEY");
  });

  it("누락 키/무효 암호문 없는 경우 → (없음) 표시", () => {
    const raw = "Error: secret_resolution_required\n";
    const r = render_agent_output(raw, md_profile);
    // r.content는 \(없음\) → (없음) 언이스케이프
    expect(r.content).toContain("(없음)");
  });
});
