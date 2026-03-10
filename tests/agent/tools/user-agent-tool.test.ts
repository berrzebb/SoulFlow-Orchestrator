/**
 * UserAgentTool — parse/generate/is_bot/is_mobile/compare/random 테스트.
 */
import { describe, it, expect } from "vitest";
import { UserAgentTool } from "../../../src/agent/tools/user-agent.js";

const tool = new UserAgentTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const CHROME_WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_LINUX_UA  = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
const SAFARI_MAC_UA     = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const IPHONE_UA         = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA        = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const GOOGLEBOT_UA      = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CURL_UA           = "curl/7.88.1";

describe("UserAgentTool — parse", () => {
  it("Chrome/Windows 파싱 → browser + os + is_mobile false", async () => {
    const r = await exec({ action: "parse", ua: CHROME_WINDOWS_UA }) as Record<string, unknown>;
    expect(r.browser).toBe("Chrome");
    expect(r.os).toBe("Windows");
    expect(r.is_mobile).toBe(false);
    expect(r.is_bot).toBe(false);
  });

  it("Firefox/Linux 파싱", async () => {
    const r = await exec({ action: "parse", ua: FIREFOX_LINUX_UA }) as Record<string, unknown>;
    expect(r.browser).toBe("Firefox");
    expect(r.os).toBe("Linux");
  });

  it("Safari/macOS 파싱", async () => {
    const r = await exec({ action: "parse", ua: SAFARI_MAC_UA }) as Record<string, unknown>;
    expect(r.browser).toBe("Safari");
    expect(r.os).toBe("macOS");
  });

  it("iPhone UA → is_mobile true + device iPhone", async () => {
    const r = await exec({ action: "parse", ua: IPHONE_UA }) as Record<string, unknown>;
    expect(r.is_mobile).toBe(true);
    expect(r.os).toBe("iOS");
    expect(r.device).toBe("iPhone");
  });

  it("Android UA → is_mobile true", async () => {
    const r = await exec({ action: "parse", ua: ANDROID_UA }) as Record<string, unknown>;
    expect(r.is_mobile).toBe(true);
    expect(r.os).toBe("Android");
  });

  it("Googlebot → is_bot true", async () => {
    const r = await exec({ action: "parse", ua: GOOGLEBOT_UA }) as Record<string, unknown>;
    expect(r.is_bot).toBe(true);
  });

  it("빈 UA → is_mobile false + is_bot false", async () => {
    const r = await exec({ action: "parse", ua: "" }) as Record<string, unknown>;
    expect(r.is_mobile).toBe(false);
    expect(r.is_bot).toBe(false);
  });
});

describe("UserAgentTool — generate", () => {
  it("chrome + windows → Chrome UA 생성", async () => {
    const r = await exec({ action: "generate", browser: "chrome", os: "windows" }) as Record<string, unknown>;
    expect(String(r.ua)).toContain("Chrome");
    expect(String(r.ua)).toContain("Windows");
  });

  it("firefox + linux → Firefox UA 생성", async () => {
    const r = await exec({ action: "generate", browser: "firefox", os: "linux" }) as Record<string, unknown>;
    expect(String(r.ua)).toContain("Firefox");
    expect(String(r.ua)).toContain("Linux");
  });

  it("safari + macos → Safari UA 생성", async () => {
    const r = await exec({ action: "generate", browser: "safari", os: "macos" }) as Record<string, unknown>;
    expect(String(r.ua)).toContain("Safari");
    expect(String(r.ua)).toContain("Macintosh");
  });

  it("edge + windows → Edg/ 포함 UA", async () => {
    const r = await exec({ action: "generate", browser: "edge", os: "windows" }) as Record<string, unknown>;
    expect(String(r.ua)).toContain("Edg/");
  });

  it("알 수 없는 browser → 기본 Chrome UA", async () => {
    const r = await exec({ action: "generate", browser: "unknown_browser", os: "windows" }) as Record<string, unknown>;
    expect(String(r.ua)).toContain("Chrome");
  });
});

describe("UserAgentTool — is_bot", () => {
  it("Googlebot → is_bot true", async () => {
    const r = await exec({ action: "is_bot", ua: GOOGLEBOT_UA }) as Record<string, unknown>;
    expect(r.is_bot).toBe(true);
  });

  it("curl UA → is_bot true", async () => {
    const r = await exec({ action: "is_bot", ua: CURL_UA }) as Record<string, unknown>;
    expect(r.is_bot).toBe(true);
  });

  it("일반 브라우저 UA → is_bot false", async () => {
    const r = await exec({ action: "is_bot", ua: CHROME_WINDOWS_UA }) as Record<string, unknown>;
    expect(r.is_bot).toBe(false);
  });
});

describe("UserAgentTool — is_mobile", () => {
  it("iPhone UA → is_mobile true", async () => {
    const r = await exec({ action: "is_mobile", ua: IPHONE_UA }) as Record<string, unknown>;
    expect(r.is_mobile).toBe(true);
  });

  it("데스크탑 UA → is_mobile false", async () => {
    const r = await exec({ action: "is_mobile", ua: CHROME_WINDOWS_UA }) as Record<string, unknown>;
    expect(r.is_mobile).toBe(false);
  });
});

describe("UserAgentTool — compare", () => {
  it("동일 브라우저 UA 비교 → same_browser true", async () => {
    const chrome2 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
    const r = await exec({ action: "compare", ua: CHROME_WINDOWS_UA, ua2: chrome2 }) as Record<string, unknown>;
    expect(r.same_browser).toBe(true);
    expect(r.same_os).toBe(false);
  });

  it("다른 브라우저 비교 → same_browser false", async () => {
    const r = await exec({ action: "compare", ua: CHROME_WINDOWS_UA, ua2: FIREFOX_LINUX_UA }) as Record<string, unknown>;
    expect(r.same_browser).toBe(false);
    expect(r.same_os).toBe(false);
  });

  it("ua1 + ua2 파싱 결과 모두 포함", async () => {
    const r = await exec({ action: "compare", ua: CHROME_WINDOWS_UA, ua2: CHROME_WINDOWS_UA }) as Record<string, unknown>;
    expect(r.ua1).toBeDefined();
    expect(r.ua2).toBeDefined();
    expect(r.same_browser).toBe(true);
    expect(r.same_os).toBe(true);
  });
});

describe("UserAgentTool — random", () => {
  it("ua + browser + os 필드 반환", async () => {
    const r = await exec({ action: "random" }) as Record<string, unknown>;
    expect(typeof r.ua).toBe("string");
    expect(typeof r.browser).toBe("string");
    expect(typeof r.os).toBe("string");
    expect(String(r.ua).startsWith("Mozilla/5.0")).toBe(true);
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("UserAgentTool — 미커버 분기", () => {
  const EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
  const OPERA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0";
  const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  it("parse: Edge UA → browser=Edge (L83)", async () => {
    const r = await exec({ action: "parse", ua: EDGE_UA }) as Record<string, unknown>;
    expect(r.browser).toBe("Edge");
  });

  it("parse: Opera UA → browser=Opera (L84)", async () => {
    const r = await exec({ action: "parse", ua: OPERA_UA }) as Record<string, unknown>;
    expect(r.browser).toBe("Opera");
  });

  it("parse: iPad UA → device=iPad (L107)", async () => {
    const r = await exec({ action: "parse", ua: IPAD_UA }) as Record<string, unknown>;
    expect(r.device).toBe("iPad");
  });

  it("unknown action → error (L75)", async () => {
    const r = await exec({ action: "detect", ua: CHROME_WINDOWS_UA }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
