/**
 * ContextBuilder — 미커버 분기 보충 (cov3):
 * - L16-17: try_read_first_file — 파일이 실제 존재 시 readFile + return raw
 * - L186-187, L189: _load_bootstrap_files — TOOLS.md + tool_categories 필터 + parts.push
 * - L246, L250: _build_user_content — 로컬 이미지 → data_uri branch + continue
 * - L354: _build_recent_daily_section — scope_prefix 필터로 전체 라인 제거 → continue
 * - L409: _to_image_data_uri_if_local catch 블록 — 디렉토리를 파일로 읽으려 할 때
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextBuilder } from "@src/agent/context.service.js";

async function make_ws() {
  return mkdtemp(join(tmpdir(), "ctx-cov3-"));
}

// ── L16-17, L189: AGENTS.md 실제 파일 존재 → try_read_first_file readFile 실행 ──

describe("ContextBuilder — L16-17, L189: bootstrap 파일 존재 시 readFile", () => {
  it("workspace에 AGENTS.md 있음 → L16 readFile 실행, L17 return raw, L189 parts.push", async () => {
    const ws = await make_ws();
    try {
      await writeFile(join(ws, "AGENTS.md"), "# Agents\nThis is agents config.");
      const builder = new ContextBuilder(ws);
      // _load_bootstrap_files를 간접 호출하는 build_system_prompt
      const prompt = await builder.build_system_prompt();
      // AGENTS.md 내용이 포함됨 → L16/17/189 모두 실행됨
      expect(prompt).toContain("Agents");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── L186-187: TOOLS.md + tool_categories → filter_tool_sections 실행 ──────────

describe("ContextBuilder — L186-187: TOOLS.md + tool_categories 필터", () => {
  it("TOOLS.md 파일 존재 + tool_categories non-empty → L186-187 filter_tool_sections 실행", async () => {
    const ws = await make_ws();
    try {
      const tools_content = `## web_search\nSearch the web.\n\n## calculator\nDo math.`;
      await writeFile(join(ws, "TOOLS.md"), tools_content);
      const builder = new ContextBuilder(ws);
      // _load_bootstrap_files에 tool_categories 전달하는 경로: build_system_prompt의 tool_cats 인자
      const prompt = await builder.build_system_prompt(
        [],
        new Set(["web_search"]),
      );
      // TOOLS.md가 로드되어 filter_tool_sections가 실행됨 → L186-187 커버
      expect(typeof prompt).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── L246, L250: _build_user_content — 로컬 PNG → image_url branch ───────────

describe("ContextBuilder — L246, L250: 로컬 이미지 → data_uri 분기", () => {
  it("유효한 로컬 PNG → image_url content 추가 (L246) + continue (L250)", async () => {
    const ws = await make_ws();
    try {
      const img_path = join(ws, "photo.png");
      // 최소 PNG 바이트
      const png_bytes = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c62600000000002000193e221bc30000000049454e44ae426082",
        "hex",
      );
      await writeFile(img_path, png_bytes);
      const builder = new ContextBuilder(ws);
      // _build_user_content(text, [local_png_path])
      const result = (builder as any)._build_user_content("Hello", [img_path]);
      // 배열 반환 (로컬 이미지가 data_uri로 변환됨)
      expect(Array.isArray(result)).toBe(true);
      const items = result as Array<{ type: string }>;
      expect(items.some((item) => item.type === "image_url")).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── L354: scope_prefix 필터로 모든 라인 제거 → continue ─────────────────────

describe("ContextBuilder — L354: scope_prefix 필터로 전체 라인 제거", () => {
  it("다른 채널 스코프 엔트리만 있을 때 → filtered.length=0 → L354 continue", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(3);
      await builder.memory_store.write_daily(
        "- [slack:C999: 완전히 다른 채널 항목 one]\n- [slack:C999: 완전히 다른 채널 항목 two]"
      );
      const prompt = await builder.build_system_prompt(
        [],
        undefined,
        { channel: "slack", chat_id: "C001" },
      );
      expect(typeof prompt).toBe("string");
      expect(prompt).not.toContain("C999");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── filter_lines_by_scope: ## Session 형식 + block_matches 초기값 버그 ────────

describe("ContextBuilder — filter_lines_by_scope: ## Session scope 필터링", () => {
  it("## Session 형식이 올바른 채널만 포함, 다른 채널은 제외", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(1);
      // telegram 채널 Session 항목 + slack 채널 Session 항목
      const daily = [
        "## Session 2026-03-12 — telegram:6931693790:alice",
        "[03:10] **User:** 식당 추천해줘",
        "[03:11] **Bot:** 아미고 타워 근처 식당입니다",
        "",
        "## Session 2026-03-12 — slack:C001:bot",
        "[03:20] **User:** 슬랙 메시지",
        "[03:21] **Bot:** 슬랙 응답",
      ].join("\n");
      await builder.memory_store.write_daily(daily);
      // telegram scope → telegram Session만 포함
      const prompt = await builder.build_system_prompt(
        [], undefined, { channel: "telegram", chat_id: "6931693790" },
      );
      expect(prompt).toContain("식당 추천해줘");
      expect(prompt).not.toContain("슬랙 메시지");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("block_matches 초기값 false — 헤더 이전 내용이 포함되지 않음", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(1);
      // 헤더 없이 raw 텍스트로 시작하는 daily
      const daily = [
        "raw line before any header — should be excluded",
        "### telegram:6931693790:alice 03:10",
        "**User:** 식당 찾아줘",
        "**Bot:** 네 알겠습니다",
      ].join("\n");
      await builder.memory_store.write_daily(daily);
      const prompt = await builder.build_system_prompt(
        [], undefined, { channel: "telegram", chat_id: "6931693790" },
      );
      expect(prompt).toContain("식당 찾아줘");
      expect(prompt).not.toContain("raw line before any header");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("### turn-recorder와 ## Session이 혼재할 때 각각 올바르게 scope 필터링", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(1);
      const daily = [
        "### telegram:6931693790:alice 03:10",
        "**User:** 텔레그램 메시지",
        "**Bot:** 텔레그램 응답",
        "",
        "## Session 2026-03-12 — slack:C001:bot",
        "[03:15] **User:** 슬랙 세션 메시지",
        "[03:15] **Bot:** 슬랙 세션 응답",
        "",
        "### telegram:6931693790:alice 03:20",
        "**User:** 두번째 텔레그램",
        "**Bot:** 두번째 텔레그램 응답",
      ].join("\n");
      await builder.memory_store.write_daily(daily);
      // telegram scope
      const prompt = await builder.build_system_prompt(
        [], undefined, { channel: "telegram", chat_id: "6931693790" },
      );
      expect(prompt).toContain("텔레그램 메시지");
      expect(prompt).toContain("두번째 텔레그램");
      expect(prompt).not.toContain("슬랙 세션 메시지");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── L409: _to_image_data_uri_if_local catch — 디렉토리를 파일로 읽으려 할 때 ──

describe("ContextBuilder — L409: _to_image_data_uri_if_local catch 블록", () => {
  it(".png 이름의 디렉토리 전달 → readFileSync EISDIR throw → catch null 반환 (L409)", async () => {
    const ws = await make_ws();
    try {
      // "fake.png"라는 이름의 디렉토리 생성
      const fake_png_dir = join(ws, "fake.png");
      await mkdir(fake_png_dir);
      const builder = new ContextBuilder(ws);
      // existsSync → true (dir), readFileSync → EISDIR throw → catch → null
      const result = (builder as any)._to_image_data_uri_if_local(fake_png_dir);
      expect(result).toBeNull();
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ── L348: _build_recent_daily_section — 빈 raw → continue ───────────────────

describe("ContextBuilder — L348: 빈 daily 내용 → continue", () => {
  it("daily 목록에 있지만 내용이 공백인 날짜 → L348 continue", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(3);
      // 공백만 작성 → write 후 read_daily는 trim() → "" → !raw → L348
      await builder.memory_store.write_daily("   ");
      const prompt = await builder.build_system_prompt();
      // chunks = [] → Recent Daily 섹션 없음
      expect(prompt).not.toContain("Recent Daily");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
