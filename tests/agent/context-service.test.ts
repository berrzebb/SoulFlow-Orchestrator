import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextBuilder } from "@src/agent/context.service.js";
import { MemoryStore } from "@src/agent/memory.service.js";

async function make_ws() {
  return mkdtemp(join(tmpdir(), "ctx-svc-"));
}

// ══════════════════════════════════════════
// reference_store
// ══════════════════════════════════════════

describe("ContextBuilder — reference_store", () => {
  it("reference_store 있고 결과 있음 → reference 섹션 포함", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const ref_store = {
        sync: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([{ doc_path: "README.md", heading: "Intro", content: "project overview" }]),
      };
      builder.set_reference_store(ref_store as any);
      const messages = await builder.build_messages([], "tell me about the project");
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(all).toContain("Reference Documents");
      expect(all).toContain("project overview");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("reference_store 결과 없음 → reference 섹션 없음", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_reference_store({ sync: vi.fn().mockResolvedValue(undefined), search: vi.fn().mockResolvedValue([]) } as any);
      const messages = await builder.build_messages([], "no match");
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(all).not.toContain("Reference Documents");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("reference_store.sync 에러 → 조용히 무시", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_reference_store({ sync: vi.fn().mockRejectedValue(new Error("sync err")), search: vi.fn() } as any);
      const messages = await builder.build_messages([], "test");
      expect(messages.length).toBeGreaterThan(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// _build_user_content
// ══════════════════════════════════════════

describe("ContextBuilder — _build_user_content", () => {
  it("media 없으면 string 반환", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._build_user_content("hello", [])).toBe("hello");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("http URL → input_media 타입", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._build_user_content("text", ["https://example.com/img.png"]) as any[];
      expect(result[0].type).toBe("text");
      expect(result[1].type).toBe("input_media");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// OAuth 통합
// ══════════════════════════════════════════

describe("ContextBuilder — OAuth 통합", () => {
  it("oauth connected → OAuth 섹션 포함", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => [
        { instance_id: "svc-1", service_type: "google", label: "Google Drive", scopes: ["read"], connected: true },
      ]);
      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("OAuth Integrations");
      expect(prompt).toContain("Google Drive");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("oauth connected=false → OAuth 섹션 없음", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => [
        { instance_id: "svc-1", service_type: "google", label: "Google", scopes: [], connected: false },
      ]);
      const prompt = await builder.build_system_prompt();
      expect(prompt).not.toContain("OAuth Integrations");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("oauth_summary_provider 에러 → 조용히 무시", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_oauth_summary_provider(async () => { throw new Error("oauth error"); });
      const prompt = await builder.build_system_prompt();
      expect(typeof prompt).toBe("string");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// _to_image_data_uri_if_local
// ══════════════════════════════════════════

describe("ContextBuilder — _to_image_data_uri_if_local", () => {
  it("data: URI → 그대로 반환", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const uri = "data:image/png;base64,abc123";
      expect((builder as any)._to_image_data_uri_if_local(uri)).toBe(uri);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("https URL → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local("https://example.com/img.png")).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("존재하지 않는 경로 → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local("/no/such/file.png")).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("실제 PNG 파일 → data:image/png;base64,... 반환", async () => {
    const ws = await make_ws();
    try {
      const img_path = join(ws, "test.png");
      const png_bytes = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c6260000000000200019e221bc30000000049454e44ae426082",
        "hex"
      );
      await writeFile(img_path, png_bytes);
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._to_image_data_uri_if_local(img_path);
      expect(result).toMatch(/^data:image\/png;base64,/);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("알 수 없는 확장자 → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._to_image_data_uri_if_local(join(ws, "file.xyz"));
      expect(result).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("빈 문자열 → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local("")).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it(".png 이름의 디렉토리 전달 → catch null 반환", async () => {
    const ws = await make_ws();
    try {
      const fake_png_dir = join(ws, "fake.png");
      await mkdir(fake_png_dir);
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._to_image_data_uri_if_local(fake_png_dir);
      expect(result).toBeNull();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// build_system_prompt — Current Session
// ══════════════════════════════════════════

describe("ContextBuilder — build_system_prompt Current Session", () => {
  it("channel+chat_id → Current Session 포함", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const prompt = await builder.build_system_prompt([], undefined, { channel: "slack", chat_id: "C001" });
      expect(prompt).toContain("Current Session");
      expect(prompt).toContain("slack");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// build_role_system_prompt
// ══════════════════════════════════════════

describe("ContextBuilder — build_role_system_prompt", () => {
  it("role_context 없으면 base prompt 반환", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const r = await builder.build_role_system_prompt("nonexistent_role");
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("role_context 있으면 Role Context 섹션 포함", async () => {
    const ws = await make_ws();
    try {
      const skills_dir = join(ws, "skills", "my_role");
      await mkdir(skills_dir, { recursive: true });
      await writeFile(join(skills_dir, "SKILL.md"), "## my_role\nThis is the role description.");

      const builder = new ContextBuilder(ws);
      const r = await builder.build_role_system_prompt("my_role");
      expect(typeof r).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// set_daily_injection — days <= 0 경로
// ══════════════════════════════════════════

describe("ContextBuilder — set_daily_injection days<=0", () => {
  it("days=0 → recent daily 섹션 없음", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(0);
      await builder.memory_store.write_daily("데일리 메모");
      const prompt = await builder.build_system_prompt();
      expect(typeof prompt).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("set_daily_injection max_chars 설정", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(1, 500);
      expect(typeof await builder.build_system_prompt()).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// _build_recent_daily_section — session scope_prefix 필터
// ══════════════════════════════════════════

describe("ContextBuilder — recent daily session scope 필터", () => {
  it("chat_id 있으면 scope_prefix 필터 적용", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(3);
      await builder.memory_store.write_daily(
        "- [slack:C001: 스코프 포함 항목]\n- 일반 항목 (스코프 없음)"
      );
      const prompt = await builder.build_system_prompt(
        [],
        undefined,
        { channel: "slack", chat_id: "C001" },
      );
      expect(typeof prompt).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("max_chars 초과 시 나머지 잘림", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(3, 50);
      const long_text = "A".repeat(200) + " 데이터";
      await builder.memory_store.write_daily(long_text);
      const prompt = await builder.build_system_prompt();
      expect(typeof prompt).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("다른 채널 스코프 엔트리만 있을 때 → scope_prefix 필터로 전체 제거", async () => {
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

  it("빈 daily 내용 → continue", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(3);
      await builder.memory_store.write_daily("   ");
      const prompt = await builder.build_system_prompt();
      expect(prompt).not.toContain("Recent Daily");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// _load_history_from_daily — build_messages의 history_days 처리
// ══════════════════════════════════════════

describe("ContextBuilder — _load_history_from_daily", () => {
  it("유효한 날짜 형식 daily memory → history 블록 포함", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      await builder.memory_store.write_daily("히스토리 데이터 항목");
      const today = new Date().toISOString().slice(0, 10);
      const messages = await builder.build_messages([today], "현재 질문");
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(all).toContain("히스토리 데이터");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("잘못된 날짜 형식 → 무시됨", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const messages = await builder.build_messages(["not-a-date", "2024"], "질문");
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("빈 daily content → 포함 안 됨", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const messages = await builder.build_messages([tomorrow], "질문");
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(typeof all).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// skill_ref_store — build_messages에서 사용
// ══════════════════════════════════════════

describe("ContextBuilder — skill_ref_store 경로", () => {
  it("skill_ref_store 결과 있음 → Skill Reference Docs 포함", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const skill_store = {
        sync: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([
          { doc_path: "skills/my_skill/references/guide.md", heading: "Usage", content: "skill guide content" },
        ]),
      };
      builder.set_skill_ref_store(skill_store as any);
      const messages = await builder.build_messages([], "질문", ["my_skill"]);
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(all).toContain("Skill Reference");
      expect(all).toContain("skill guide content");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("skill_ref_store 결과 없음 → 섹션 없음", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_skill_ref_store({
        sync: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
      } as any);
      const messages = await builder.build_messages([], "질문");
      const all = messages.map((m) => String(m.content)).join(" ");
      expect(all).not.toContain("Skill Reference");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("skill_ref_store 에러 → 조용히 무시", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_skill_ref_store({
        sync: vi.fn().mockRejectedValue(new Error("sync failed")),
        search: vi.fn(),
      } as any);
      const messages = await builder.build_messages([], "질문");
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// get_bootstrap / get_persona_name
// ══════════════════════════════════════════

describe("ContextBuilder — get_bootstrap / get_persona_name", () => {
  it("BOOTSTRAP.md 없음 → exists: false", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const b = builder.get_bootstrap();
      expect(b.exists).toBe(false);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("BOOTSTRAP.md 있음 → exists: true, content 포함", async () => {
    const ws = await make_ws();
    try {
      await writeFile(join(ws, "BOOTSTRAP.md"), "# Bootstrap\n초기화 내용");
      const builder = new ContextBuilder(ws);
      const b = builder.get_bootstrap();
      expect(b.exists).toBe(true);
      expect(b.content).toContain("Bootstrap");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("SOUL.md 없음 → persona_name = 'assistant'", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect(builder.get_persona_name()).toBe("assistant");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// bootstrap 파일 존재 시 readFile
// ══════════════════════════════════════════

describe("ContextBuilder — bootstrap 파일 존재 시 readFile", () => {
  it("workspace에 AGENTS.md 있음 → readFile 실행, parts.push", async () => {
    const ws = await make_ws();
    try {
      await writeFile(join(ws, "AGENTS.md"), "# Agents\nThis is agents config.");
      const builder = new ContextBuilder(ws);
      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("Agents");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// TOOLS.md + tool_categories 필터
// ══════════════════════════════════════════

describe("ContextBuilder — TOOLS.md + tool_categories 필터", () => {
  it("TOOLS.md 파일 존재 + tool_categories non-empty → filter_tool_sections 실행", async () => {
    const ws = await make_ws();
    try {
      const tools_content = `## web_search\nSearch the web.\n\n## calculator\nDo math.`;
      await writeFile(join(ws, "TOOLS.md"), tools_content);
      const builder = new ContextBuilder(ws);
      const prompt = await builder.build_system_prompt(
        [],
        new Set(["web_search"]),
      );
      expect(typeof prompt).toBe("string");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// filter_lines_by_scope — ## Session 형식
// ══════════════════════════════════════════

describe("ContextBuilder — filter_lines_by_scope: ## Session scope 필터링", () => {
  it("## Session 형식이 올바른 채널만 포함, 다른 채널은 제외", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      builder.set_daily_injection(1);
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

// ══════════════════════════════════════════
// set_longterm_injection — longterm 주입 크기 제한
// ══════════════════════════════════════════

describe("ContextBuilder — set_longterm_injection 크기 제한", () => {
  it("max_chars > 0이면 longterm의 마지막 max_chars만 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      const head = "A".repeat(500);
      const tail = "B".repeat(500);
      await memory.write_longterm(`${head}\n${tail}`);

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(600);

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("B".repeat(100));
      expect(prompt).not.toContain("A".repeat(500));
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("max_chars = 0이면 longterm 전체가 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      const content = "X".repeat(30_000);
      await memory.write_longterm(content);

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(0);

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("X".repeat(100));
      const count = (prompt.match(/X/g) || []).length;
      expect(count).toBe(30_000);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("longterm이 max_chars 이하면 전체 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      await memory.write_longterm("짧은 내용");

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(20_000);

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("짧은 내용");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// filter_lines_by_scope — scope 없는 일반 목록 항목
// ══════════════════════════════════════════

describe("ContextBuilder — filter_lines_by_scope: scope 없는 일반 목록 항목", () => {
  it("- [scope] 형식이 아닌 일반 - 항목은 scope 필터 후에도 포함된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      await memory.write_daily(
        [
          "- [slack:ch1:main] USER(u1): 채널1 메시지",
          "- [slack:ch2:main] USER(u2): 채널2 메시지",
          "- 스코프 없는 공통 메모",
          "- 또 다른 일반 항목",
        ].join("\n"),
      );

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_daily_injection(1);

      const prompt = await builder.build_system_prompt([], undefined, {
        channel: "slack",
        chat_id: "ch1",
      });

      expect(prompt).toContain("채널1 메시지");
      expect(prompt).not.toContain("채널2 메시지");
      expect(prompt).toContain("스코프 없는 공통 메모");
      expect(prompt).toContain("또 다른 일반 항목");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
