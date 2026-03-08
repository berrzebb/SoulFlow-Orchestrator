/**
 * send_file_handler / web_form_handler / web_table_handler / embedding_handler 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { send_file_handler } from "@src/agent/nodes/send-file.js";
import { web_form_handler } from "@src/agent/nodes/web-form.js";
import { web_table_handler } from "@src/agent/nodes/web-table.js";
import { embedding_handler } from "@src/agent/nodes/embedding.js";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

// ── 공통 헬퍼 ──

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_state(memory: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-1",
    title: "test",
    objective: "obj",
    channel: "slack",
    chat_id: "C001",
    status: "running" as const,
    current_phase: 0,
    phases: [],
    memory,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function make_runner(overrides: Partial<RunnerContext> = {}): RunnerContext {
  return {
    state: make_state(),
    options: {} as RunnerContext["options"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
    ...overrides,
  } as unknown as RunnerContext;
}

// ══════════════════════════════════════════
// send_file_handler
// ══════════════════════════════════════════

function make_send_file_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "sf1",
    node_type: "send_file",
    file_path: "/tmp/report.pdf",
    target: "origin",
    caption: "",
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("send_file_handler — 메타데이터", () => {
  it("node_type = send_file", () => expect(send_file_handler.node_type).toBe("send_file"));
  it("output_schema에 ok/message_id/file_name 포함", () => {
    const names = send_file_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("ok");
    expect(names).toContain("message_id");
    expect(names).toContain("file_name");
  });
  it("create_default: file_path/target 포함", () => {
    const def = send_file_handler.create_default!();
    expect(def).toHaveProperty("file_path");
    expect(def).toHaveProperty("target");
  });
});

describe("send_file_handler — execute()", () => {
  it("기본 execute → ok=true", async () => {
    const result = await send_file_handler.execute(make_send_file_node(), make_ctx());
    expect(result.output.ok).toBe(true);
    expect(result.output.message_id).toBe("");
    expect(result.output.file_name).toBe("");
  });
});

describe("send_file_handler — runner_execute: send_message 없음", () => {
  it("send_message 미제공 → ok=false", async () => {
    const runner = make_runner({ options: {} as RunnerContext["options"] });
    const result = await send_file_handler.runner_execute!(make_send_file_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
  });
});

describe("send_file_handler — runner_execute: send_message 성공", () => {
  it("파일 전송 성공 → ok=true, file_name 반환", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "msg-42" });
    const runner = make_runner({
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const result = await send_file_handler.runner_execute!(make_send_file_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(true);
    expect(result.output.message_id).toBe("msg-42");
    expect(result.output.file_name).toBe("report.pdf");
    expect(send_message).toHaveBeenCalled();
  });

  it("caption 포함 → 메시지 content에 포함", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
    const runner = make_runner({
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const node = make_send_file_node({ caption: "결과 보고서" } as OrcheNodeDefinition);
    await send_file_handler.runner_execute!(node, make_ctx(), runner);
    const req = send_message.mock.calls[0][0] as { content: string };
    expect(req.content).toContain("결과 보고서");
  });

  it("file_path 템플릿 → memory에서 resolve", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "m2" });
    const runner = make_runner({
      state: make_state({ fname: "output.csv" }),
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const node = make_send_file_node({ file_path: "/workspace/{{memory.fname}}" } as OrcheNodeDefinition);
    const result = await send_file_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.file_name).toBe("output.csv");
  });

  it("send_message 실패 → ok=false", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: false, message_id: undefined });
    const runner = make_runner({
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const result = await send_file_handler.runner_execute!(make_send_file_node(), make_ctx(), runner);
    expect(result.output.ok).toBe(false);
    expect(result.output.message_id).toBe("");
  });

  it("중첩 슬래시 경로 → 마지막 세그먼트만 file_name", async () => {
    const send_message = vi.fn().mockResolvedValue({ ok: true, message_id: "m3" });
    const runner = make_runner({
      options: { send_message } as unknown as RunnerContext["options"],
    });
    const node = make_send_file_node({ file_path: "/deep/nested/path/file.zip" } as OrcheNodeDefinition);
    const result = await send_file_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.file_name).toBe("file.zip");
  });
});

describe("send_file_handler — test()", () => {
  it("file_path 없음 → 경고", () => {
    const r = send_file_handler.test!(make_send_file_node({ file_path: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("file_path"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = send_file_handler.test!(make_send_file_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: target/file_path/caption 포함", () => {
    const r = send_file_handler.test!(make_send_file_node(), make_ctx());
    expect(r.preview).toHaveProperty("target");
    expect(r.preview).toHaveProperty("file_path");
  });
});

// ══════════════════════════════════════════
// web_form_handler
// ══════════════════════════════════════════

function make_web_form_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "wf1",
    node_type: "web_form",
    url: "https://example.com/form",
    fields: { "#name": "Alice", "#email": "a@b.com" },
    submit_selector: "#submit",
    wait_after_ms: 1000,
    ...overrides,
  } as OrcheNodeDefinition;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("web_form_handler — 메타데이터", () => {
  it("node_type = web_form", () => expect(web_form_handler.node_type).toBe("web_form"));
  it("output_schema에 fields_filled/submitted/snapshot 포함", () => {
    const names = web_form_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("fields_filled");
    expect(names).toContain("submitted");
    expect(names).toContain("snapshot");
  });
  it("create_default: url/fields/submit_selector 포함", () => {
    const def = web_form_handler.create_default!();
    expect(def).toHaveProperty("url");
    expect(def).toHaveProperty("fields");
    expect(def).toHaveProperty("submit_selector");
  });
});

describe("web_form_handler — execute(): url 없음", () => {
  it("url 비어 있음 → error 반환", async () => {
    const result = await web_form_handler.execute(
      make_web_form_node({ url: "" } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(result.output.submitted).toBe(false);
    expect(String(result.output.error)).toContain("url");
  });
});

describe("web_form_handler — execute(): fields 없음", () => {
  it("fields 비어 있음 → error 반환", async () => {
    const result = await web_form_handler.execute(
      make_web_form_node({ fields: {} } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(result.output.submitted).toBe(false);
    expect(String(result.output.error)).toContain("fields");
  });
});

describe("web_form_handler — execute(): 성공", () => {
  it("fetch 성공 → fields_filled 반환 + snapshot 포함", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => "<html><body>OK</body></html>",
    }));
    const result = await web_form_handler.execute(make_web_form_node(), make_ctx());
    expect(Array.isArray(result.output.fields_filled)).toBe(true);
    expect((result.output.fields_filled as unknown[]).length).toBe(2);
    expect(result.output.submitted).toBe(true); // submit_selector 있음
    expect(result.output.snapshot).toContain("OK");
  });

  it("submit_selector 없음 → submitted=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => "<html>page</html>",
    }));
    const result = await web_form_handler.execute(
      make_web_form_node({ submit_selector: "" } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(result.output.submitted).toBe(false);
  });

  it("fetch 오류 → error 필드 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network_failure")));
    const result = await web_form_handler.execute(make_web_form_node(), make_ctx());
    expect(result.output.submitted).toBe(false);
    expect(String(result.output.error)).toContain("network_failure");
  });

  it("url 템플릿 → memory에서 resolve", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => "<html>form</html>",
    }));
    const ctx = make_ctx({ base: "example.com" });
    const node = make_web_form_node({ url: "https://{{memory.base}}/form" } as OrcheNodeDefinition);
    await web_form_handler.execute(node, ctx);
    const call_url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call_url).toContain("example.com");
  });
});

describe("web_form_handler — test()", () => {
  it("url 없음 → 경고", () => {
    const r = web_form_handler.test!(make_web_form_node({ url: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("url"))).toBe(true);
  });

  it("fields 없음 → 경고", () => {
    const r = web_form_handler.test!(make_web_form_node({ fields: {} } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("fields"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = web_form_handler.test!(make_web_form_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: url/fields_count/submit_selector 포함", () => {
    const r = web_form_handler.test!(make_web_form_node(), make_ctx());
    expect(r.preview).toHaveProperty("url");
    expect(r.preview).toHaveProperty("fields_count", 2);
    expect(r.preview).toHaveProperty("submit_selector");
  });
});

// ══════════════════════════════════════════
// web_table_handler
// ══════════════════════════════════════════

function make_web_table_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "wt1",
    node_type: "web_table",
    url: "https://example.com/table",
    selector: "table",
    max_rows: 10,
    ...overrides,
  } as OrcheNodeDefinition;
}

const SAMPLE_HTML = `
<html><body>
<table>
  <tr><th>Name</th><th>Age</th></tr>
  <tr><td>Alice</td><td>30</td></tr>
  <tr><td>Bob</td><td>25</td></tr>
</table>
</body></html>
`;

describe("web_table_handler — 메타데이터", () => {
  it("node_type = web_table", () => expect(web_table_handler.node_type).toBe("web_table"));
  it("output_schema에 headers/rows/total 포함", () => {
    const names = web_table_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("headers");
    expect(names).toContain("rows");
    expect(names).toContain("total");
  });
  it("create_default: url/selector/max_rows 포함", () => {
    const def = web_table_handler.create_default!();
    expect(def).toHaveProperty("url");
    expect(def).toHaveProperty("selector");
    expect(def).toHaveProperty("max_rows");
  });
});

describe("web_table_handler — execute(): url 없음", () => {
  it("url 비어 있음 → error 반환, rows=[]", async () => {
    const result = await web_table_handler.execute(
      make_web_table_node({ url: "" } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect(result.output.total).toBe(0);
    expect(String(result.output.error)).toContain("url");
  });
});

describe("web_table_handler — execute(): 성공", () => {
  it("HTML 테이블 파싱 → headers/rows/total 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => SAMPLE_HTML,
    }));
    const result = await web_table_handler.execute(make_web_table_node(), make_ctx());
    expect((result.output.headers as string[])).toContain("Name");
    expect((result.output.headers as string[])).toContain("Age");
    expect(result.output.total).toBe(2);
    const rows = result.output.rows as Record<string, string>[];
    expect(rows[0]["Name"]).toBe("Alice");
    expect(rows[1]["Age"]).toBe("25");
  });

  it("테이블 없는 HTML → 빈 결과", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => "<html><body>no table here</body></html>",
    }));
    const result = await web_table_handler.execute(make_web_table_node(), make_ctx());
    expect(result.output.total).toBe(0);
    expect((result.output.rows as unknown[]).length).toBe(0);
  });

  it("max_rows 제한 → 초과 행 잘림", async () => {
    const rows_html = Array.from({ length: 20 }, (_, i) => `<tr><td>item${i}</td></tr>`).join("");
    const html = `<html><body><table><tr><th>Item</th></tr>${rows_html}</table></body></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => html }));
    const result = await web_table_handler.execute(
      make_web_table_node({ max_rows: 5 } as OrcheNodeDefinition),
      make_ctx(),
    );
    expect((result.output.total as number)).toBeLessThanOrEqual(5);
  });

  it("fetch 오류 → error 필드 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await web_table_handler.execute(make_web_table_node(), make_ctx());
    expect(result.output.total).toBe(0);
    expect(String(result.output.error)).toContain("timeout");
  });

  it("url 템플릿 resolve", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => SAMPLE_HTML }));
    const ctx = make_ctx({ host: "data.example.com" });
    const node = make_web_table_node({ url: "https://{{memory.host}}/table" } as OrcheNodeDefinition);
    await web_table_handler.execute(node, ctx);
    const call_url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call_url).toContain("data.example.com");
  });
});

describe("web_table_handler — test()", () => {
  it("url 없음 → 경고", () => {
    const r = web_table_handler.test!(make_web_table_node({ url: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("url"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = web_table_handler.test!(make_web_table_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: url/selector/max_rows 포함", () => {
    const r = web_table_handler.test!(make_web_table_node(), make_ctx());
    expect(r.preview).toHaveProperty("url");
    expect(r.preview).toHaveProperty("selector");
    expect(r.preview).toHaveProperty("max_rows");
  });
});

// ══════════════════════════════════════════
// embedding_handler
// ══════════════════════════════════════════

function make_embedding_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "em1",
    node_type: "embedding",
    input_field: "text",
    model: "text-embedding-3-small",
    batch_size: 32,
    dimensions: undefined,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("embedding_handler — 메타데이터", () => {
  it("node_type = embedding", () => expect(embedding_handler.node_type).toBe("embedding"));
  it("output_schema에 embeddings/model/dimensions/count 포함", () => {
    const names = embedding_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("embeddings");
    expect(names).toContain("model");
    expect(names).toContain("dimensions");
    expect(names).toContain("count");
  });
  it("create_default: input_field/model/batch_size 포함", () => {
    const def = embedding_handler.create_default!();
    expect(def).toHaveProperty("input_field");
    expect(def).toHaveProperty("model");
    expect(def).toHaveProperty("batch_size");
  });
});

describe("embedding_handler — execute(): 텍스트 없음", () => {
  it("텍스트 비어 있음 → count=0, embeddings=[]", async () => {
    const result = await embedding_handler.execute(make_embedding_node(), make_ctx({}));
    expect(result.output.count).toBe(0);
    expect(result.output.embeddings).toEqual([]);
  });
});

describe("embedding_handler — execute(): 더미 임베딩", () => {
  it("텍스트 있음 → 더미 벡터 생성 (dimensions=384)", async () => {
    const ctx = make_ctx({ text: "hello world" });
    const result = await embedding_handler.execute(make_embedding_node(), ctx);
    expect(result.output.count).toBe(1);
    expect((result.output.embeddings as unknown[][]).length).toBe(1);
    expect((result.output.embeddings as unknown[][])[0].length).toBe(384);
    expect(result.output.dimensions).toBe(384);
  });

  it("dimensions 지정 → 해당 차원 벡터", async () => {
    const ctx = make_ctx({ text: "test" });
    const node = make_embedding_node({ dimensions: 128 } as OrcheNodeDefinition);
    const result = await embedding_handler.execute(node, ctx);
    expect((result.output.embeddings as unknown[][])[0].length).toBe(128);
    expect(result.output.dimensions).toBe(128);
  });

  it("배열 텍스트 → 여러 임베딩", async () => {
    const ctx = make_ctx({ text: ["one", "two", "three"] });
    const result = await embedding_handler.execute(make_embedding_node(), ctx);
    expect(result.output.count).toBe(3);
  });
});

describe("embedding_handler — runner_execute: embed 서비스 없음", () => {
  it("embed 서비스 없음 → execute() 폴백 (더미 벡터)", async () => {
    const runner = make_runner({ services: undefined });
    const ctx = make_ctx({ text: "fallback text" });
    const result = await embedding_handler.runner_execute!(make_embedding_node(), ctx, runner);
    expect(result.output.count).toBe(1);
    expect((result.output.embeddings as unknown[][]).length).toBe(1);
  });
});

describe("embedding_handler — runner_execute: embed 서비스 있음", () => {
  it("embed 서비스 사용 → 실제 임베딩 반환", async () => {
    const mock_embed = vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      token_usage: 5,
    });
    const runner = make_runner({
      services: { embed: mock_embed } as RunnerContext["services"],
    });
    const ctx = make_ctx({ text: "hello" });
    const result = await embedding_handler.runner_execute!(make_embedding_node(), ctx, runner);
    expect(mock_embed).toHaveBeenCalled();
    expect(result.output.count).toBe(1);
    expect(result.output.token_usage).toBe(5);
    expect(result.output.dimensions).toBe(3);
  });

  it("배치 처리 → 여러 배치로 분할", async () => {
    const mock_embed = vi.fn().mockResolvedValue({
      embeddings: [[0.1], [0.2]],
      token_usage: 2,
    });
    const runner = make_runner({
      services: { embed: mock_embed } as RunnerContext["services"],
    });
    const ctx = make_ctx({ text: ["a", "b", "c", "d"] });
    const node = make_embedding_node({ batch_size: 2 } as OrcheNodeDefinition);
    const result = await embedding_handler.runner_execute!(node, ctx, runner);
    expect(mock_embed).toHaveBeenCalledTimes(2); // 4개를 2개씩 → 2 배치
    expect(result.output.token_usage).toBe(4); // 2+2
  });

  it("텍스트 없음 → count=0 (embed 서비스 있어도)", async () => {
    const mock_embed = vi.fn();
    const runner = make_runner({
      services: { embed: mock_embed } as RunnerContext["services"],
    });
    const ctx = make_ctx({});
    const result = await embedding_handler.runner_execute!(make_embedding_node(), ctx, runner);
    expect(result.output.count).toBe(0);
    expect(mock_embed).not.toHaveBeenCalled();
  });
});

describe("embedding_handler — test()", () => {
  it("input_field 없음 → 경고", () => {
    const r = embedding_handler.test!(make_embedding_node({ input_field: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("input_field"))).toBe(true);
  });

  it("model 없음 → 경고", () => {
    const r = embedding_handler.test!(make_embedding_node({ model: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("model"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = embedding_handler.test!(make_embedding_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: input_field/model/batch_size 포함", () => {
    const r = embedding_handler.test!(make_embedding_node(), make_ctx());
    expect(r.preview).toHaveProperty("input_field");
    expect(r.preview).toHaveProperty("model");
    expect(r.preview).toHaveProperty("batch_size");
  });
});
