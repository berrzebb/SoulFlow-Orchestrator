/** User-Agent 도구 — UA 문자열 파싱/생성/비교. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface ParsedUA {
  browser?: string;
  browser_version?: string;
  os?: string;
  os_version?: string;
  device?: string;
  is_mobile: boolean;
  is_bot: boolean;
}

const BOT_PATTERNS = /bot|crawler|spider|scraper|headless|phantom|puppeteer|playwright|selenium|curl|wget|httpie|postman/i;

export class UserAgentTool extends Tool {
  readonly name = "user_agent";
  readonly category = "data" as const;
  readonly description = "User-Agent utilities: parse, generate, is_bot, is_mobile, compare, random.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "is_bot", "is_mobile", "compare", "random"], description: "Operation" },
      ua: { type: "string", description: "User-Agent string" },
      ua2: { type: "string", description: "Second UA for compare" },
      browser: { type: "string", description: "Browser name (generate)" },
      os: { type: "string", description: "OS name (generate)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const ua = String(params.ua || "");
        return JSON.stringify(this.parse_ua(ua));
      }
      case "generate": {
        const browser = String(params.browser || "chrome");
        const os = String(params.os || "windows");
        return JSON.stringify({ ua: this.generate_ua(browser, os) });
      }
      case "is_bot": {
        const ua = String(params.ua || "");
        return JSON.stringify({ ua, is_bot: BOT_PATTERNS.test(ua) });
      }
      case "is_mobile": {
        const ua = String(params.ua || "");
        const is_mobile = /mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile/i.test(ua);
        return JSON.stringify({ ua, is_mobile });
      }
      case "compare": {
        const p1 = this.parse_ua(String(params.ua || ""));
        const p2 = this.parse_ua(String(params.ua2 || ""));
        return JSON.stringify({
          same_browser: p1.browser === p2.browser,
          same_os: p1.os === p2.os,
          ua1: p1,
          ua2: p2,
        });
      }
      case "random": {
        const browsers = ["chrome", "firefox", "safari", "edge"];
        const oses = ["windows", "macos", "linux", "android", "ios"];
        const b = browsers[Math.floor(Math.random() * browsers.length)];
        const o = oses[Math.floor(Math.random() * oses.length)];
        return JSON.stringify({ ua: this.generate_ua(b, o), browser: b, os: o });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_ua(ua: string): ParsedUA {
    const result: ParsedUA = { is_mobile: false, is_bot: BOT_PATTERNS.test(ua) };

    // Browser detection
    if (/Edg\/(\d[\d.]*)/i.test(ua)) { result.browser = "Edge"; result.browser_version = RegExp.$1; }
    else if (/OPR\/(\d[\d.]*)/i.test(ua)) { result.browser = "Opera"; result.browser_version = RegExp.$1; }
    else if (/Chrome\/(\d[\d.]*)/i.test(ua)) { result.browser = "Chrome"; result.browser_version = RegExp.$1; }
    else if (/Safari\/(\d[\d.]*)/i.test(ua) && /Version\/(\d[\d.]*)/i.test(ua)) { result.browser = "Safari"; result.browser_version = RegExp.$1; }
    else if (/Firefox\/(\d[\d.]*)/i.test(ua)) { result.browser = "Firefox"; result.browser_version = RegExp.$1; }

    // OS detection
    if (/Windows NT (\d[\d.]*)/i.test(ua)) {
      result.os = "Windows"; result.os_version = RegExp.$1;
      const ver_map: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };
      if (ver_map[result.os_version]) result.os_version = ver_map[result.os_version];
    } else if (/Mac OS X (\d[\d._]*)/i.test(ua)) {
      result.os = "macOS"; result.os_version = RegExp.$1.replace(/_/g, ".");
    } else if (/Android (\d[\d.]*)/i.test(ua)) {
      result.os = "Android"; result.os_version = RegExp.$1;
    } else if (/iPhone OS (\d[\d_]*)/i.test(ua) || /iPad.*OS (\d[\d_]*)/i.test(ua)) {
      result.os = "iOS"; result.os_version = RegExp.$1.replace(/_/g, ".");
    } else if (/Linux/i.test(ua)) {
      result.os = "Linux";
    }

    // Device / Mobile
    result.is_mobile = /mobile|android|iphone|ipad|ipod/i.test(ua);
    if (/iphone/i.test(ua)) result.device = "iPhone";
    else if (/ipad/i.test(ua)) result.device = "iPad";
    else if (/android/i.test(ua) && result.is_mobile) result.device = "Android Phone";

    return result;
  }

  private generate_ua(browser: string, os: string): string {
    const os_str: Record<string, string> = {
      windows: "Windows NT 10.0; Win64; x64",
      macos: "Macintosh; Intel Mac OS X 10_15_7",
      linux: "X11; Linux x86_64",
      android: "Linux; Android 14; Pixel 8",
      ios: "iPhone; CPU iPhone OS 17_0 like Mac OS X",
    };
    const platform = os_str[os.toLowerCase()] || os_str.windows;
    switch (browser.toLowerCase()) {
      case "chrome": return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`;
      case "firefox": return `Mozilla/5.0 (${platform}; rv:121.0) Gecko/20100101 Firefox/121.0`;
      case "safari": return `Mozilla/5.0 (${platform}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15`;
      case "edge": return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0`;
      default: return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`;
    }
  }
}
