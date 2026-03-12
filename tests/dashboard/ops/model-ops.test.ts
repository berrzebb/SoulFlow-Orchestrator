/**
 * create_model_ops — mock runtime으로 모든 위임 경로 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { create_model_ops } from "@src/dashboard/ops/model.js";

function make_runtime() {
  return {
    list_models: vi.fn().mockResolvedValue([{ name: "llama3" }]),
    pull_model_by_name: vi.fn().mockResolvedValue({ ok: true }),
    pull_model_stream: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield "data"; } }),
    delete_model: vi.fn().mockResolvedValue({ ok: true }),
    list_running: vi.fn().mockResolvedValue([]),
    health_check: vi.fn().mockResolvedValue({ running: true }),
    switch_model: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("create_model_ops", () => {
  it("list → runtime.list_models() 호출", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    const r = await ops.list();
    expect(rt.list_models).toHaveBeenCalled();
    expect(r).toHaveLength(1);
  });

  it("pull → runtime.pull_model_by_name() 호출", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    await ops.pull("llama3");
    expect(rt.pull_model_by_name).toHaveBeenCalledWith("llama3");
  });

  it("pull_stream → runtime.pull_model_stream() 호출", () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    ops.pull_stream("llama3");
    expect(rt.pull_model_stream).toHaveBeenCalledWith("llama3");
  });

  it("delete → runtime.delete_model() 호출", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    await ops.delete("llama3");
    expect(rt.delete_model).toHaveBeenCalledWith("llama3");
  });

  it("list_active → runtime.list_running() 호출", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    await ops.list_active();
    expect(rt.list_running).toHaveBeenCalled();
  });

  it("get_runtime_status → runtime.health_check() → Record 반환", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    const r = await ops.get_runtime_status();
    expect(rt.health_check).toHaveBeenCalled();
    expect(typeof r).toBe("object");
  });

  it("switch_model → runtime.switch_model() → Record 반환", async () => {
    const rt = make_runtime();
    const ops = create_model_ops(rt as any);
    const r = await ops.switch_model("llama3");
    expect(rt.switch_model).toHaveBeenCalledWith("llama3");
    expect(typeof r).toBe("object");
  });
});
