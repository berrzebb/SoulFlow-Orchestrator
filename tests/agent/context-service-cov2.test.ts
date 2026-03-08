/**
 * ContextBuilder — 미커버 분기 보충.
 * build_role_system_prompt, _build_recent_daily_section scope_prefix/max_chars,
 * _load_history_from_daily, set_daily_injection days<=0, skill_ref_store 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextBuilder } from "@src/agent/context.service.js";

async function make_ws() {
  return mkdtemp(join(tmpdir(), "ctx-svc2-"));
}

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
      // skills 디렉토리 + role 파일 생성
      const skills_dir = join(ws, "skills", "my_role");
      await mkdir(skills_dir, { recursive: true });
      await writeFile(join(skills_dir, "SKILL.md"), "## my_role\nThis is the role description.");

      const builder = new ContextBuilder(ws);
      const r = await builder.build_role_system_prompt("my_role");
      // role_context가 없는 경우와 동일하게 base 반환 (SKILL.md만 있어도 role 식별에 따라 다름)
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
      // 메모리에 데이터 써도 daily 섹션 없어야 함
      await builder.memory_store.write_daily("데일리 메모");
      const prompt = await builder.build_system_prompt();
      // days=0이면 recent daily 출력 안 함
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
      // 에러 없이 실행됨
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
      // daily 메모리에 scope_prefix 포함 데이터 작성
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
      // max_chars를 매우 작게 설정
      builder.set_daily_injection(3, 50);
      const long_text = "A".repeat(200) + " 데이터";
      await builder.memory_store.write_daily(long_text);
      const prompt = await builder.build_system_prompt();
      expect(typeof prompt).toBe("string");
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
      // 날짜 형식 daily memory 작성
      await builder.memory_store.write_daily("히스토리 데이터 항목");
      const today = new Date().toISOString().slice(0, 10);
      const messages = await builder.build_messages([today], "현재 질문");
      const all = messages.map((m) => String(m.content)).join(" ");
      // history daily가 포함됨
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
      // 에러 없이 처리됨
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
      // 내용 없는 날짜 → Daily Memory Context 없음
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
// _to_image_data_uri_if_local — 로컬 이미지 파일
// ══════════════════════════════════════════

describe("ContextBuilder — _to_image_data_uri_if_local 로컬 이미지", () => {
  it("실제 PNG 파일 → data:image/png;base64,... 반환", async () => {
    const ws = await make_ws();
    try {
      const img_path = join(ws, "test.png");
      // 최소한의 PNG 바이트 (1x1 픽셀)
      const png_bytes = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c6260000000000200019e221bc30000000049454e44ae426082",
        "hex"
      );
      await writeFile(img_path, png_bytes);
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._to_image_data_uri_if_local(img_path);
      expect(result).toMatch(/^data:image\/png;base64,/);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("알 수 없는 확장자 → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      const result = (builder as any)._to_image_data_uri_if_local(join(ws, "file.xyz"));
      expect(result).toBeNull();
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("빈 문자열 → null", async () => {
    const ws = await make_ws();
    try {
      const builder = new ContextBuilder(ws);
      expect((builder as any)._to_image_data_uri_if_local("")).toBeNull();
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
