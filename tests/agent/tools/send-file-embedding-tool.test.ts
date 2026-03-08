/**
 * SendFileTool / EmbeddingTool 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SendFileTool } from "@src/agent/tools/send-file.js";
import { EmbeddingTool } from "@src/agent/tools/embedding.js";

// ══════════════════════════════════════════
// SendFileTool
// ══════════════════════════════════════════

const tmp = mkdtempSync(join(tmpdir(), "send-file-tool-test-"));
const test_file = join(tmp, "report.pdf");
writeFileSync(test_file, "fake pdf content");

afterEach(() => { vi.restoreAllMocks(); });

import { afterAll } from "vitest";
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

function make_send_tool(has_callback = true) {
  const cb = has_callback ? vi.fn().mockResolvedValue(undefined) : null;
  const tool = new SendFileTool({ send_callback: cb, workspace: tmp });
  return { tool, cb };
}

describe("SendFileTool — 메타데이터", () => {
  it("name = send_file", () => expect(make_send_tool().tool.name).toBe("send_file"));
  it("category = file_transfer", () => expect(make_send_tool().tool.category).toBe("file_transfer"));
  it("policy_flags: write=true", () => expect(make_send_tool().tool.policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_send_tool().tool.to_schema().type).toBe("function"));
});

describe("SendFileTool — 유효성 검사 오류", () => {
  it("send_callback 없음 → Error 반환", async () => {
    const { tool } = make_send_tool(false);
    const r = await tool.execute({ file_path: test_file }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("callback");
  });

  it("channel 없음 → Error 반환", async () => {
    const { tool } = make_send_tool();
    const r = await tool.execute({ file_path: test_file }, { channel: "", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("channel");
  });

  it("chat_id 없음 → Error 반환", async () => {
    const { tool } = make_send_tool();
    const r = await tool.execute({ file_path: test_file }, { channel: "slack", chat_id: "" });
    expect(r).toContain("Error");
    expect(r).toContain("channel");
  });

  it("file_path 없음 → Error 반환", async () => {
    const { tool } = make_send_tool();
    const r = await tool.execute({ file_path: "" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("file_path");
  });

  it("존재하지 않는 파일 → Error 반환", async () => {
    const { tool } = make_send_tool();
    const r = await tool.execute({ file_path: "nonexistent_xyz.pdf" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("file not found");
  });
});

describe("SendFileTool — 파일 전송 성공", () => {
  it("파일 전송 → file_sent 반환", async () => {
    const { tool, cb } = make_send_tool();
    const r = await tool.execute({ file_path: test_file }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("file_sent");
    expect(r).toContain("report.pdf");
    expect(cb).toHaveBeenCalledOnce();
    const msg = cb!.mock.calls[0][0];
    expect(msg.channel).toBe("slack");
    expect(msg.chat_id).toBe("C1");
    expect(msg.media).toHaveLength(1);
    expect(msg.metadata?.kind).toBe("file_delivery");
  });

  it("caption 포함 → content에 caption 사용", async () => {
    const { tool, cb } = make_send_tool();
    await tool.execute({ file_path: test_file, caption: "첨부 파일입니다" }, { channel: "slack", chat_id: "C1" });
    const msg = cb!.mock.calls[0][0];
    expect(msg.content).toBe("첨부 파일입니다");
  });

  it("caption 없음 → content에 filename 사용", async () => {
    const { tool, cb } = make_send_tool();
    await tool.execute({ file_path: test_file }, { channel: "slack", chat_id: "C1" });
    const msg = cb!.mock.calls[0][0];
    expect(msg.content).toBe("report.pdf");
  });

  it("set_send_callback → 콜백 교체", async () => {
    const { tool } = make_send_tool(false);
    const new_cb = vi.fn().mockResolvedValue(undefined);
    tool.set_send_callback(new_cb);
    const r = await tool.execute({ file_path: test_file }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("file_sent");
    expect(new_cb).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// EmbeddingTool
// ══════════════════════════════════════════

const emb_tool = new EmbeddingTool();

const MOCK_EMBED_RESPONSE = {
  model: "text-embedding-3-small",
  data: [
    { embedding: [0.1, 0.2, 0.3] },
  ],
};

function mock_fetch_ok(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }));
}

function mock_fetch_error(status: number, text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => text,
  }));
}

describe("EmbeddingTool — 메타데이터", () => {
  it("name = embedding", () => expect(emb_tool.name).toBe("embedding"));
  it("category = ai", () => expect(emb_tool.category).toBe("ai"));
  it("policy_flags: network=true", () => expect(emb_tool.policy_flags.network).toBe(true));
  it("to_schema: function 형식", () => expect(emb_tool.to_schema().type).toBe("function"));
});

describe("EmbeddingTool — 유효성 검사 오류", () => {
  it("api_key 없음 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "embed", text: "hello" });
    expect(r).toContain("Error");
    expect(r).toContain("api_key");
  });

  it("embed: text 없음 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "embed", text: "", api_key: "sk-xxx" });
    expect(r).toContain("Error");
    expect(r).toContain("text");
  });

  it("batch_embed: 비JSON text → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "batch_embed", text: "not json", api_key: "sk-xxx" });
    expect(r).toContain("Error");
    expect(r).toContain("JSON array");
  });

  it("batch_embed: 빈 배열 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "batch_embed", text: "[]", api_key: "sk-xxx" });
    expect(r).toContain("Error");
    expect(r).toContain("non-empty");
  });

  it("batch_embed: 배열이 아님 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "batch_embed", text: JSON.stringify({ a: 1 }), api_key: "sk-xxx" });
    expect(r).toContain("Error");
  });

  it("batch_embed: 100개 초과 → Error 반환", async () => {
    const texts = Array.from({ length: 101 }, (_, i) => `text${i}`);
    const r = await emb_tool.execute({ action: "batch_embed", text: JSON.stringify(texts), api_key: "sk-xxx" });
    expect(r).toContain("Error");
    expect(r).toContain("100");
  });

  it("similarity: text_a 없음 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "similarity", text_a: "", text_b: "b", api_key: "sk-xxx" });
    expect(r).toContain("Error");
    expect(r).toContain("text_a");
  });

  it("similarity: text_b 없음 → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "similarity", text_a: "a", text_b: "", api_key: "sk-xxx" });
    expect(r).toContain("Error");
  });

  it("unknown action → Error 반환", async () => {
    const r = await emb_tool.execute({ action: "unknown_op" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

describe("EmbeddingTool — embed 성공", () => {
  it("embed → model/dimensions/embedding 반환", async () => {
    mock_fetch_ok(MOCK_EMBED_RESPONSE);
    const r = await emb_tool.execute({ action: "embed", text: "hello world", api_key: "sk-test" });
    const parsed = JSON.parse(r);
    expect(parsed.model).toBe("text-embedding-3-small");
    expect(parsed.dimensions).toBe(3);
    expect(parsed.embedding).toHaveLength(3);
  });

  it("API 오류 → Error 반환", async () => {
    mock_fetch_error(401, "Unauthorized");
    const r = await emb_tool.execute({ action: "embed", text: "test", api_key: "sk-bad" });
    expect(r).toContain("Error");
    expect(r).toContain("401");
  });

  it("fetch 예외 → Error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await emb_tool.execute({ action: "embed", text: "test", api_key: "sk-test" });
    expect(r).toContain("Error");
    expect(r).toContain("network down");
  });

  it("dimensions 파라미터 → body에 포함", async () => {
    mock_fetch_ok({ ...MOCK_EMBED_RESPONSE, data: [{ embedding: new Array(128).fill(0.1) }] });
    const r = await emb_tool.execute({ action: "embed", text: "test", api_key: "sk-test", dimensions: 128 });
    const parsed = JSON.parse(r);
    expect(parsed.dimensions).toBe(128);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.dimensions).toBe(128);
  });
});

describe("EmbeddingTool — batch_embed 성공", () => {
  it("batch_embed → count/embeddings 반환", async () => {
    const multi_resp = {
      model: "text-embedding-3-small",
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    };
    mock_fetch_ok(multi_resp);
    const texts = JSON.stringify(["text1", "text2"]);
    const r = await emb_tool.execute({ action: "batch_embed", text: texts, api_key: "sk-test" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
    expect(parsed.embeddings).toHaveLength(2);
  });
});

describe("EmbeddingTool — similarity 성공", () => {
  it("같은 벡터 → similarity=1", async () => {
    const sim_resp = {
      model: "text-embedding-3-small",
      data: [{ embedding: [1, 0, 0] }, { embedding: [1, 0, 0] }],
    };
    mock_fetch_ok(sim_resp);
    const r = await emb_tool.execute({ action: "similarity", text_a: "a", text_b: "b", api_key: "sk-test" });
    const parsed = JSON.parse(r);
    expect(parsed.similarity).toBeCloseTo(1, 5);
  });

  it("수직 벡터 → similarity=0", async () => {
    const sim_resp = {
      model: "text-embedding-3-small",
      data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
    };
    mock_fetch_ok(sim_resp);
    const r = await emb_tool.execute({ action: "similarity", text_a: "a", text_b: "b", api_key: "sk-test" });
    const parsed = JSON.parse(r);
    expect(parsed.similarity).toBeCloseTo(0, 5);
  });
});
