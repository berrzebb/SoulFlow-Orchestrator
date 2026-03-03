import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { acquire_runtime_instance_lock } from "@src/runtime/instance-lock.ts";

describe("runtime instance lock", () => {
  let workspace: string;
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  it("prevents duplicate acquisition and releases correctly", async () => {
    workspace = await mkdtemp(join(tmpdir(), "runtime-lock-"));
    const first = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
    expect(first.acquired).toBe(true);

    const second = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
    expect(second.acquired).toBe(false);
    expect(second.holder_pid).toBe(process.pid);

    await first.release();
    const third = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
    expect(third.acquired).toBe(true);
    await third.release();
  });
});
