/**
 * 노드 핸들러 catch 분기 커버리지 보충.
 * 각 핸들러의 execute() 내 catch 블록 + barcode L41 (plain string 반환) 커버.
 * tool.execute()를 throw 하도록 mock.
 */
import { describe, it, expect, vi } from "vitest";

// ── 각 tool을 mock (vi.mock은 호이스팅됨) ──────────────────────────

const graphql_execute = vi.fn();
vi.mock("@src/agent/tools/graphql.js", () => ({
  GraphqlTool: class { execute = graphql_execute; },
}));

const html_execute = vi.fn();
vi.mock("@src/agent/tools/html.js", () => ({
  HtmlTool: class { execute = html_execute; },
}));

const phone_execute = vi.fn();
vi.mock("@src/agent/tools/phone.js", () => ({
  PhoneTool: class { execute = phone_execute; },
}));

const cache_execute = vi.fn();
vi.mock("@src/agent/tools/ttl-cache.js", () => ({
  CacheTool: class { execute = cache_execute; },
}));

const mqtt_execute = vi.fn();
vi.mock("@src/agent/tools/mqtt.js", () => ({
  MqttTool: class { execute = mqtt_execute; },
}));

const barcode_execute = vi.fn();
vi.mock("@src/agent/tools/barcode.js", () => ({
  BarcodeTool: class { execute = barcode_execute; },
}));

const diff_execute = vi.fn();
vi.mock("@src/agent/tools/diff.js", () => ({
  DiffTool: class { execute = diff_execute; },
}));

// ── import handlers AFTER mocks ──────────────────────────────────

import { graphql_handler } from "@src/agent/nodes/graphql.js";
import { html_handler } from "@src/agent/nodes/html.js";
import { phone_handler } from "@src/agent/nodes/phone.js";
import { ttl_cache_handler } from "@src/agent/nodes/ttl-cache.js";
import { mqtt_handler } from "@src/agent/nodes/mqtt.js";
import { barcode_handler } from "@src/agent/nodes/barcode.js";
import { diff_handler } from "@src/agent/nodes/diff.js";

// ── 공통 픽스처 ──────────────────────────────────────────────────

function ctx() {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined } as any;
}

function node(type: string, extra: Record<string, unknown> = {}) {
  return { node_id: "n1", node_type: type, ...extra } as any;
}

// ══════════════════════════════════════════
// graphql catch (L42)
// ══════════════════════════════════════════

describe("graphql_handler — execute catch (L42)", () => {
  it("tool.execute throws → catch: { data:'{}', status:0, success:false }", async () => {
    graphql_execute.mockRejectedValueOnce(new Error("graphql network error"));
    const result = await graphql_handler.execute(node("graphql"), ctx());
    expect(result.output).toEqual({ data: "{}", status: 0, success: false });
  });
});

// ══════════════════════════════════════════
// html catch (L37)
// ══════════════════════════════════════════

describe("html_handler — execute catch (L37)", () => {
  it("tool.execute throws → catch: { result:null, success:false }", async () => {
    html_execute.mockRejectedValueOnce(new Error("html parse error"));
    const result = await html_handler.execute(node("html"), ctx());
    expect(result.output).toEqual({ result: null, success: false });
  });
});

// ══════════════════════════════════════════
// phone catch (L39)
// ══════════════════════════════════════════

describe("phone_handler — execute catch (L39)", () => {
  it("tool.execute throws → catch: { result:null, valid:false }", async () => {
    phone_execute.mockRejectedValueOnce(new Error("phone validation error"));
    const result = await phone_handler.execute(node("phone"), ctx());
    expect(result.output).toEqual({ result: null, valid: false });
  });
});

// ══════════════════════════════════════════
// ttl-cache catch (L43)
// ══════════════════════════════════════════

describe("ttl_cache_handler — execute catch (L43)", () => {
  it("tool.execute throws → catch: { result:error_msg, success:false }", async () => {
    cache_execute.mockRejectedValueOnce(new Error("cache unavailable"));
    const result = await ttl_cache_handler.execute(node("ttl_cache", { operation: "get", key: "k1" }), ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.result).toBe("string");
  });
});

// ══════════════════════════════════════════
// mqtt catch (L43)
// ══════════════════════════════════════════

describe("mqtt_handler — execute catch (L43)", () => {
  it("tool.execute throws → catch: { result:null, success:false }", async () => {
    mqtt_execute.mockRejectedValueOnce(new Error("mqtt connection refused"));
    const result = await mqtt_handler.execute(node("mqtt"), ctx());
    expect(result.output).toEqual({ result: null, success: false });
  });
});

// ══════════════════════════════════════════
// barcode L41 (plain string path) + L43 (catch)
// ══════════════════════════════════════════

describe("barcode_handler — execute branch + catch (L41, L43)", () => {
  it("tool returns plain string (not svg/json) → L41: { result, success:true }", async () => {
    barcode_execute.mockResolvedValueOnce("plain-barcode-text");
    const result = await barcode_handler.execute(node("barcode"), ctx());
    expect(result.output).toEqual({ result: "plain-barcode-text", success: true });
  });

  it("tool.execute throws → L43: { result:null, success:false }", async () => {
    barcode_execute.mockRejectedValueOnce(new Error("barcode lib error"));
    const result = await barcode_handler.execute(node("barcode"), ctx());
    expect(result.output).toEqual({ result: null, success: false });
  });
});

// ══════════════════════════════════════════
// diff catch (L43)
// ══════════════════════════════════════════

describe("diff_handler — execute catch (L43)", () => {
  it("tool.execute throws → catch: { result:error_msg, success:false }", async () => {
    diff_execute.mockRejectedValueOnce(new Error("diff algorithm error"));
    const result = await diff_handler.execute(node("diff"), ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.result).toBe("string");
  });
});
