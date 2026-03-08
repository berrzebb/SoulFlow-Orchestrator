/**
 * WebFormTool / WebTableTool 커버리지 — run_agent_browser 모킹.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebFormTool } from "@src/agent/tools/web-form.js";
import { WebTableTool } from "@src/agent/tools/web-table.js";

// agent-browser-client 모킹
vi.mock("@src/agent/tools/agent-browser-client.js", () => ({
  run_agent_browser: vi.fn(),
  detect_agent_browser_binary: vi.fn().mockReturnValue("agent-browser"),
  parse_last_json_line: vi.fn().mockReturnValue(null),
}));

import * as ab_client from "@src/agent/tools/agent-browser-client.js";
const mock_run_ab = ab_client.run_agent_browser as ReturnType<typeof vi.fn>;

const form_tool = new WebFormTool();
const table_tool = new WebTableTool();

function make_ab_ok(stdout = "", parsed: Record<string, unknown> | null = null) {
  return { ok: true, stdout, stderr: "", parsed };
}

function make_ab_fail(stderr = "error") {
  return { ok: false, stdout: "", stderr, parsed: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// WebFormTool
// ══════════════════════════════════════════

describe("WebFormTool — 메타데이터", () => {
  it("name = web_form", () => expect(form_tool.name).toBe("web_form"));
  it("category = web", () => expect(form_tool.category).toBe("web"));
  it("policy_flags: network=true, write=true", () => {
    expect(form_tool.policy_flags.network).toBe(true);
    expect(form_tool.policy_flags.write).toBe(true);
  });
  it("to_schema: function 형식", () => expect(form_tool.to_schema().type).toBe("function"));
});

describe("WebFormTool — 유효성 검사 오류", () => {
  it("url 없음 → Error 반환", async () => {
    const r = await form_tool.execute({ url: "", fields: { "#x": "y" } });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("fields 없음 → Error 반환", async () => {
    const r = await form_tool.execute({ url: "https://example.com", fields: null });
    expect(r).toContain("Error");
    expect(r).toContain("fields");
  });

  it("fields 빈 객체 → Error 반환", async () => {
    const r = await form_tool.execute({ url: "https://example.com", fields: {} });
    expect(r).toContain("Error");
    expect(r).toContain("fields");
  });

  it("fields 배열 → Error 반환", async () => {
    const r = await form_tool.execute({ url: "https://example.com", fields: ["a"] });
    expect(r).toContain("Error");
    expect(r).toContain("fields");
  });

  it("cancelled signal → Error 반환", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await form_tool.execute(
      { url: "https://example.com", fields: { "#x": "y" } },
      { signal: controller.signal },
    );
    expect(r).toContain("Error");
    expect(r).toContain("cancel");
  });
});

describe("WebFormTool — open 실패", () => {
  it("open 실패 → Error 반환", async () => {
    mock_run_ab.mockResolvedValueOnce(make_ab_fail("browser not found"));
    const r = await form_tool.execute({ url: "https://example.com", fields: { "#email": "a@b.com" } });
    expect(r).toContain("Error");
  });
});

describe("WebFormTool — 폼 작성 성공", () => {
  it("필드 채우기 + submit + snapshot", async () => {
    const snapshot_line = JSON.stringify({ data: { snapshot: "page content" } });
    // open → wait → fill → click → wait → snapshot → close
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait load
      .mockResolvedValueOnce(make_ab_ok()) // fill #name
      .mockResolvedValueOnce(make_ab_ok()) // click submit
      .mockResolvedValueOnce(make_ab_ok()) // wait after submit
      .mockResolvedValueOnce(make_ab_ok(snapshot_line)) // snapshot
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await form_tool.execute({
      url: "https://example.com/form",
      fields: { "#name": "Alice" },
      submit_selector: "#submit",
      wait_after_ms: 100,
    });
    const parsed = JSON.parse(r);
    expect(parsed.url).toBe("https://example.com/form");
    expect(parsed.fields_filled).toHaveLength(1);
    expect(parsed.fields_filled[0].ok).toBe(true);
    expect(parsed.submit?.ok).toBe(true);
  });

  it("submit 없음 → submit=null", async () => {
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_ok()) // fill
      .mockResolvedValueOnce(make_ab_ok()) // snapshot
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await form_tool.execute({
      url: "https://example.com/form",
      fields: { "#q": "test" },
      submit_selector: "",
    });
    const parsed = JSON.parse(r);
    expect(parsed.submit).toBeNull();
  });

  it("fill 실패 → ok=false 기록", async () => {
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_fail("element not found")) // fill
      .mockResolvedValueOnce(make_ab_ok()) // snapshot
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await form_tool.execute({
      url: "https://example.com",
      fields: { "#missing": "val" },
    });
    const parsed = JSON.parse(r);
    expect(parsed.fields_filled[0].ok).toBe(false);
    expect(parsed.fields_filled[0].error).toContain("element not found");
  });
});

// ══════════════════════════════════════════
// WebTableTool
// ══════════════════════════════════════════

describe("WebTableTool — 메타데이터", () => {
  it("name = web_table", () => expect(table_tool.name).toBe("web_table"));
  it("category = web", () => expect(table_tool.category).toBe("web"));
  it("policy_flags: network=true", () => expect(table_tool.policy_flags.network).toBe(true));
  it("to_schema: function 형식", () => expect(table_tool.to_schema().type).toBe("function"));
});

describe("WebTableTool — 유효성 검사 오류", () => {
  it("url 없음 → Error 반환", async () => {
    const r = await table_tool.execute({ url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("cancelled signal → Error 반환", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await table_tool.execute({ url: "https://example.com" }, { signal: controller.signal });
    expect(r).toContain("Error");
    expect(r).toContain("cancel");
  });
});

describe("WebTableTool — open 실패", () => {
  it("open 실패 → Error 반환", async () => {
    mock_run_ab.mockResolvedValueOnce(make_ab_fail("not installed"));
    const r = await table_tool.execute({ url: "https://example.com/table" });
    expect(r).toContain("Error");
  });
});

describe("WebTableTool — 테이블 추출 성공", () => {
  it("evaluate 성공 → JSON 결과 반환", async () => {
    const table_json = JSON.stringify({
      headers: ["Name", "Age"],
      rows: [{ Name: "Alice", Age: "30" }],
      total: 1,
    });
    const eval_line = JSON.stringify({ data: { result: table_json } });
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_ok(eval_line, { data: { result: table_json } })) // evaluate
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await table_tool.execute({
      url: "https://example.com/table",
      selector: "table",
      max_rows: 50,
    });
    const parsed = JSON.parse(r);
    expect(parsed.url).toBe("https://example.com/table");
    expect(parsed.headers).toContain("Name");
    expect(parsed.total).toBe(1);
  });

  it("evaluate 실패 → Error 반환", async () => {
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_fail("eval error")) // evaluate
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await table_tool.execute({ url: "https://example.com/table" });
    expect(r).toContain("Error");
    expect(r).toContain("evaluate");
  });

  it("JSON parse 오류 → Error 반환", async () => {
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_ok("invalid json{{{", null)) // evaluate - bad JSON
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await table_tool.execute({ url: "https://example.com/table" });
    expect(r).toContain("Error");
    expect(r).toContain("parse");
  });

  it("stdout에서 직접 JSON 파싱 (data.result 없음)", async () => {
    const table_json = JSON.stringify({ headers: ["Col"], rows: [], total: 0 });
    mock_run_ab
      .mockResolvedValueOnce(make_ab_ok()) // open
      .mockResolvedValueOnce(make_ab_ok()) // wait
      .mockResolvedValueOnce(make_ab_ok(table_json)) // evaluate - stdout has JSON
      .mockResolvedValueOnce(make_ab_ok()); // close

    const r = await table_tool.execute({ url: "https://example.com/table" });
    const parsed = JSON.parse(r);
    expect(parsed.total).toBe(0);
    expect(parsed.headers).toContain("Col");
  });
});
